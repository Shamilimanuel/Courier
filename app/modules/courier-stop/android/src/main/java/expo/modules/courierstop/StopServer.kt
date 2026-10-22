package expo.modules.courierstop

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.security.MessageDigest
import java.util.Collections
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * The phone's own small server, so PCs and other phones can send to it:
 * the same routes as the PC (agent/src/server.js, uploads.js,
 * handshake.js), minus the ones a phone can't do. It runs inside
 * StopService, so it keeps listening with the app closed.
 *
 * Deliberately tiny: one request per connection (Connection: close), bodies
 * by Content-Length only, which is all Courier's own senders use.
 */
internal class StopServer(private val context: Context) {
  private var socket: ServerSocket? = null
  private var pool: ExecutorService = Executors.newCachedThreadPool()
  private val busy = Collections.synchronizedSet(HashSet<String>())
  @Volatile var port = 0
    private set

  fun start(preferred: Int): Int {
    var bound: ServerSocket? = null
    for (p in preferred until preferred + 6) {
      try {
        val s = ServerSocket()
        s.reuseAddress = true
        s.bind(InetSocketAddress(p))
        bound = s
        port = p
        break
      } catch (_: IOException) {
        // taken; try the next one
      }
    }
    val s = bound ?: throw IOException("No free port for Courier")
    socket = s
    if (pool.isShutdown) pool = Executors.newCachedThreadPool()
    Partials.sweep(context)
    Thread({ acceptLoop(s) }, "courier-accept").start()
    return port
  }

  fun stop() {
    try {
      socket?.close()
    } catch (_: IOException) {
    }
    socket = null
    pool.shutdownNow()
  }

  private fun acceptLoop(s: ServerSocket) {
    while (!s.isClosed) {
      val client = try {
        s.accept()
      } catch (_: IOException) {
        break
      }
      try {
        pool.execute { handle(client) }
      } catch (_: Exception) {
        client.close()
      }
    }
  }

  // --------------------------------------------------------------- HTTP --

  private class Request(
    val method: String,
    val path: String,
    val query: Map<String, String>,
    val headers: Map<String, String>,
    val input: InputStream,
    val length: Long,
    val ip: String,
  ) {
    fun header(name: String) = headers[name.lowercase()]
    fun json(): JSONObject {
      if (length <= 0) return JSONObject()
      if (length > 1_000_000) throw IOException("too big")
      val buf = ByteArray(length.toInt())
      var read = 0
      while (read < buf.size) {
        val n = input.read(buf, read, buf.size - read)
        if (n < 0) break
        read += n
      }
      return try {
        JSONObject(String(buf, 0, read, Charsets.UTF_8))
      } catch (_: Exception) {
        JSONObject()
      }
    }
  }

  private fun readHead(input: InputStream): String? {
    val out = ByteArrayOutputStream()
    var matched = 0
    val end = byteArrayOf(13, 10, 13, 10)
    while (out.size() < 16384) {
      val b = input.read()
      if (b < 0) return null
      out.write(b)
      matched = if (b.toByte() == end[matched]) matched + 1 else if (b == 13) 1 else 0
      if (matched == 4) return out.toString("ISO-8859-1")
    }
    return null
  }

  private fun handle(client: Socket) {
    client.use { sock ->
      try {
        sock.soTimeout = 30_000
        val input = BufferedInputStream(sock.getInputStream(), 64 * 1024)
        val out = sock.getOutputStream()
        val head = readHead(input) ?: return
        val lines = head.split("\r\n")
        val parts = lines[0].split(" ")
        if (parts.size < 2) return
        val headers = HashMap<String, String>()
        for (line in lines.drop(1)) {
          val i = line.indexOf(':')
          if (i > 0) headers[line.substring(0, i).trim().lowercase()] = line.substring(i + 1).trim()
        }
        val target = parts[1]
        val q = target.indexOf('?')
        val path = if (q >= 0) target.substring(0, q) else target
        val query = HashMap<String, String>()
        if (q >= 0) {
          for (pair in target.substring(q + 1).split("&")) {
            val eq = pair.indexOf('=')
            if (eq > 0) query[URLDecoder.decode(pair.substring(0, eq), "UTF-8")] = URLDecoder.decode(pair.substring(eq + 1), "UTF-8")
          }
        }
        val ip = (sock.inetAddress?.hostAddress ?: "").removePrefix("::ffff:")
        val req = Request(parts[0].uppercase(), path, query, headers, input, headers["content-length"]?.toLongOrNull() ?: 0L, ip)
        route(req, out)
      } catch (_: Exception) {
        // the other side went away; nothing to answer
      }
    }
  }

  private fun send(out: OutputStream, status: Int, body: JSONObject) {
    val bytes = body.toString().toByteArray(Charsets.UTF_8)
    val reason = when (status) {
      200 -> "OK"; 204 -> "No Content"; 400 -> "Bad Request"; 401 -> "Unauthorized"; 403 -> "Forbidden"
      404 -> "Not Found"; 409 -> "Conflict"; 429 -> "Too Many Requests"; else -> "Error"
    }
    val head = "HTTP/1.1 $status $reason\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
    out.write(head.toByteArray(Charsets.ISO_8859_1))
    out.write(bytes)
    out.flush()
  }

  private fun error(out: OutputStream, status: Int, message: String) = send(out, status, JSONObject().put("error", message))

  private fun authorized(req: Request): Boolean {
    val auth = req.header("authorization") ?: ""
    val given = if (auth.startsWith("Bearer ")) auth.substring(7) else req.query["token"] ?: ""
    val ok = given.isNotEmpty() && MessageDigest.isEqual(given.toByteArray(), StopConfig.token(context).toByteArray())
    if (ok) {
      // A paired stop says who it is: keep its address up to date.
      req.header("x-courier-from")?.take(80)?.let { id ->
        Peers.rememberAddress(context, id, req.ip)
        StopBus.send("onPeerSeen", mapOf("id" to id, "ip" to req.ip))
      }
    }
    return ok
  }

  private fun route(req: Request, out: OutputStream) {
    val p = req.path
    when {
      req.method == "OPTIONS" -> send(out, 204, JSONObject())
      req.method == "GET" && p == "/health" -> health(out)
      req.method == "POST" && p == "/pair/request" -> pairRequest(req, out)
      req.method == "GET" && p.startsWith("/pair/request/") -> pairStatus(p.removePrefix("/pair/request/"), out)
      !authorized(req) -> error(out, 401, "unauthorized")
      req.method == "POST" && p == "/pair/introduce" -> introduce(req, out)
      req.method == "POST" && p == "/uploads" -> createUpload(req, out)
      p.startsWith("/uploads/") -> upload(req, p.removePrefix("/uploads/"), out)
      req.method == "POST" && p == "/clipboard" -> text(req, out)
      req.method == "GET" && p == "/clipboard" ->
        error(out, 403, "A phone only shares its clipboard from inside Courier. Use Clipboard on the phone.")
      req.method == "GET" && p == "/files" -> send(out, 200, JSONObject().put("files", JSONArray()))
      else -> error(out, 404, "not found")
    }
  }

  // ------------------------------------------------------------- routes --

  private fun health(out: OutputStream) {
    send(
      out, 200,
      JSONObject()
        .put("api", 2)
        .put("id", StopConfig.id(context))
        .put("name", StopConfig.name(context))
        .put("hostname", StopConfig.name(context))
        .put("kind", "phone")
        .put("port", port)
        .put("platform", "android"),
    )
  }

  private fun expired(r: PairRequests.Req) {
    Notes.cancelPairRequest(context, r.requestId)
    StopBus.send("onPairSettled", mapOf("requestId" to r.requestId, "state" to r.state))
  }

  private fun pairRequest(req: Request, out: OutputStream) {
    val peer = PairRequests.readPeer(jsonToMap(req.json()), req.ip) ?: return error(out, 400, "Missing who is asking.")
    val (r, refused) = PairRequests.create(peer, ::expired)
    if (r == null) return error(out, 429, refused ?: "Try again later.")
    Notes.pairRequest(context, r.requestId, peer["name"] as String, r.code)
    StopBus.send("onPairRequest", mapOf("requestId" to r.requestId, "code" to r.code, "name" to peer["name"], "kind" to peer["kind"], "ip" to peer["ip"]))
    send(out, 200, JSONObject().put("requestId", r.requestId).put("code", r.code))
  }

  private fun pairStatus(requestId: String, out: OutputStream) {
    val state = PairRequests.status(requestId, ::expired)
    val body = JSONObject().put("state", state)
    if (state == "allowed") body.put("stop", JSONObject(StopConfig.self(context)))
    send(out, 200, body)
  }

  private fun introduce(req: Request, out: OutputStream) {
    val peer = PairRequests.readPeer(jsonToMap(req.json()), req.ip) ?: return error(out, 400, "Missing who is asking.")
    Peers.addIntroduced(context, peer)
    StopBus.send("onPeerIntroduced", peer)
    send(out, 200, JSONObject().put("id", StopConfig.id(context)).put("name", StopConfig.name(context)).put("kind", "phone"))
  }

  private fun createUpload(req: Request, out: OutputStream) {
    val body = req.json()
    val name = safeName(body.optString("name")) ?: return error(out, 400, "a file name is required")
    val size = body.optLong("size", -1)
    if (size < 0 || size > 8L * 1024 * 1024 * 1024) return error(out, 400, "size must be 0 to 8 GB")
    // No "already there?" question on a phone: Downloads keeps both and
    // names the new one "photo (1).jpg".
    val id = Partials.create(context, name, size, req.header("x-courier-from"))
    send(out, 200, JSONObject().put("uploadId", id).put("offset", 0).put("size", size))
  }

  private fun upload(req: Request, id: String, out: OutputStream) {
    val meta = Partials.meta(context, id) ?: return error(out, 404, "That upload is gone. Send the file again.")
    val part = Partials.part(context, id)
    when (req.method) {
      "GET" -> send(out, 200, JSONObject().put("offset", part.length()).put("size", meta.optLong("size")))
      "DELETE" -> {
        Partials.remove(context, id)
        send(out, 200, JSONObject().put("deleted", true))
      }
      "PUT" -> receive(req, id, meta, out)
      else -> error(out, 404, "not found")
    }
  }

  private fun receive(req: Request, id: String, meta: JSONObject, out: OutputStream) {
    val part = Partials.part(context, id)
    val size = meta.optLong("size")
    val have = part.length()
    if (!busy.add(id)) return send(out, 409, JSONObject().put("code", "busy").put("offset", have))
    try {
      val offset = req.query["offset"]?.toLongOrNull()
      if (offset != have) return send(out, 409, JSONObject().put("code", "offset").put("offset", have))
      if (have + req.length > size) return error(out, 400, "more bytes than the size given")

      // Keep the phone and its Wi-Fi awake while bytes are coming in, even
      // with the screen off. Let go the moment they stop.
      val locks = Locks(context)
      try {
        FileOutputStream(part, true).use { file ->
          val buf = ByteArray(64 * 1024)
          var left = req.length
          while (left > 0) {
            val n = req.input.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
            if (n < 0) break
            file.write(buf, 0, n)
            left -= n
          }
        }
      } finally {
        locks.release()
      }

      val now = part.length()
      if (now < size) return send(out, 200, JSONObject().put("offset", now).put("size", size))
      finish(id, meta, out)
    } finally {
      busy.remove(id)
    }
  }

  private fun finish(id: String, meta: JSONObject, out: OutputStream) {
    val saved = Saver.save(context, Partials.part(context, id), meta.optString("name", "file"))
    Partials.remove(context, id)
    val fromId = meta.optString("from").takeIf { it.isNotBlank() && it != "null" }
    val fromName = Peers.nameOf(context, fromId)
    val entryId = id
    Inbox.add(
      context,
      mapOf(
        "id" to entryId, "kind" to "file", "name" to saved.name, "size" to saved.size, "uri" to saved.uri,
        "mime" to saved.mime, "from" to (fromName ?: ""), "fromId" to (fromId ?: ""), "at" to System.currentTimeMillis(),
      ),
    )
    Notes.fileArrived(context, saved.name, fromName, saved.size, saved.uri, saved.mime)
    StopBus.send("onFileArrived", mapOf("id" to entryId, "name" to saved.name, "size" to saved.size, "uri" to saved.uri, "mime" to saved.mime, "from" to (fromName ?: "")))
    send(out, 200, JSONObject().put("saved", true).put("name", saved.name).put("size", saved.size).put("sizeVerified", saved.size == meta.optLong("size")))
  }

  private fun text(req: Request, out: OutputStream) {
    val body = req.json()
    if (!body.has("text")) return error(out, 400, "text is required")
    val text = body.optString("text")
    val kind = if (body.optString("kind") == "text") "text" else "clip"
    // Putting text on the clipboard is allowed from the background (only
    // reading it isn't), but it has to happen on the main thread.
    Handler(Looper.getMainLooper()).post {
      try {
        val cm = context.getSystemService(ClipboardManager::class.java)
        cm?.setPrimaryClip(ClipData.newPlainText("Courier", text))
      } catch (_: Exception) {
        // the note below still shows the text
      }
    }
    val fromId = req.header("x-courier-from")
    val fromName = Peers.nameOf(context, fromId)
    val entryId = "t" + System.currentTimeMillis()
    Inbox.add(context, mapOf("id" to entryId, "kind" to kind, "text" to text.take(20_000), "from" to (fromName ?: ""), "fromId" to (fromId ?: ""), "at" to System.currentTimeMillis()))
    Notes.textArrived(context, text.take(2000), kind, fromName)
    StopBus.send("onTextArrived", mapOf("id" to entryId, "text" to text, "kind" to kind, "from" to (fromName ?: "")))
    send(out, 200, JSONObject().put("ok", true))
  }
}

/** A partial wake lock plus a Wi-Fi lock, for the length of one transfer. */
internal class Locks(context: Context) {
  private val wake: PowerManager.WakeLock? = try {
    context.getSystemService(PowerManager::class.java)?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "courier:transfer")?.apply {
      setReferenceCounted(false)
      acquire(30 * 60 * 1000L)
    }
  } catch (_: Exception) {
    null
  }

  @Suppress("DEPRECATION")
  private val wifi: WifiManager.WifiLock? = try {
    val wm = context.applicationContext.getSystemService(WifiManager::class.java)
    wm?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "courier:transfer")?.apply {
      setReferenceCounted(false)
      acquire()
    }
  } catch (_: Exception) {
    null
  }

  fun release() {
    try {
      wake?.release()
    } catch (_: Exception) {
    }
    try {
      wifi?.release()
    } catch (_: Exception) {
    }
  }
}
