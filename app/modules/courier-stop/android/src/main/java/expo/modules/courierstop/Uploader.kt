package expo.modules.courierstop

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import org.json.JSONObject
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Sends a file from this phone to a PC or another phone, in a way that
 * survives the Wi-Fi dropping out (the same protocol as the desktop's
 * client.sendFile): create the upload, stream it, and when the connection
 * breaks ask "how far did you get?" and carry on from there, a few times
 * with a growing pause before giving up. Giving up keeps the place on the
 * other side, so "Carry on" (resumeUploadId) continues later.
 *
 * Reports through StopBus: onUploadProgress, onUploadDone, onUploadError.
 */
internal object Uploader {
  private const val RETRIES = 8
  private val pool = Executors.newFixedThreadPool(2)
  private val jobs = ConcurrentHashMap<String, Job>()

  private class Job(val id: String) {
    @Volatile var cancelled = false
    @Volatile var conn: java.net.HttpURLConnection? = null
    @Volatile var uploadId: String? = null
  }

  private class Fatal(message: String, val status: Int) : Exception(message)

  fun start(
    context: Context, jobId: String, target: Target, uri: String, name: String, givenSize: Long,
    onDuplicate: String?, resumeUploadId: String?,
  ) {
    val job = Job(jobId)
    job.uploadId = resumeUploadId
    jobs[jobId] = job
    pool.execute {
      val locks = Locks(context)
      try {
        val result = run(context, job, target, Uri.parse(uri), name, givenSize, onDuplicate)
        StopBus.send("onUploadDone", mapOf("jobId" to jobId, "result" to result))
      } catch (e: Exception) {
        val cancelled = job.cancelled
        StopBus.send(
          "onUploadError",
          mapOf(
            "jobId" to jobId,
            "cancelled" to cancelled,
            "message" to (if (cancelled) "Cancelled" else e.message ?: "Sending failed"),
            "uploadId" to (if (cancelled) null else job.uploadId),
            "old" to (e is Fatal && e.status == 404 && job.uploadId == null),
          ),
        )
      } finally {
        locks.release()
        jobs.remove(jobId)
      }
    }
  }

  fun cancel(jobId: String) {
    val job = jobs[jobId] ?: return
    job.cancelled = true
    try {
      job.conn?.disconnect()
    } catch (_: Exception) {
    }
  }

  private fun sizeOf(context: Context, uri: Uri): Long {
    try {
      context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
        if (c.moveToFirst() && !c.isNull(0)) return c.getLong(0)
      }
    } catch (_: Exception) {
    }
    try {
      context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { if (it.length >= 0) return it.length }
    } catch (_: Exception) {
    }
    return -1
  }

  private fun json(text: String): JSONObject = try {
    JSONObject(text)
  } catch (_: Exception) {
    JSONObject()
  }

  private fun run(context: Context, job: Job, target: Target, uri: Uri, name: String, givenSize: Long, onDuplicate: String?): Map<String, Any?> {
    val size = if (givenSize > 0) givenSize else sizeOf(context, uri)
    if (size < 0) throw IOException("Couldn't tell how big that file is")

    val resuming = job.uploadId != null
    if (!resuming) {
      val body = JSONObject().put("name", name).put("size", size)
      if (onDuplicate != null) body.put("onDuplicate", onDuplicate)
      val (status, text) = Net.request(target, "POST", "/uploads", body.toString())
      val r = json(text)
      when {
        status == 409 && r.optString("code") == "duplicate" ->
          return mapOf("duplicate" to true, "existingSize" to r.optLong("existingSize"))
        status == 404 -> throw Fatal("That stop runs an older Courier", 404)
        status == 401 -> throw Fatal("Pairing token was rejected. Pair again.", 401)
        status !in 200..299 -> throw Fatal(r.optString("error", "Sending failed ($status)"), status)
      }
      if (r.optBoolean("skipped")) return mapOf("skipped" to true)
      job.uploadId = r.getString("uploadId")
    }

    var offset = 0L
    if (resuming) {
      val (status, text) = Net.request(target, "GET", "/uploads/${job.uploadId}", null)
      if (status == 404) throw Fatal("That half-sent file is gone there. Send it again.", 404)
      if (status in 200..299) offset = json(text).optLong("offset", 0)
    }

    var failures = 0
    while (true) {
      if (job.cancelled) throw IOException("Cancelled")
      try {
        val r = put(context, job, target, uri, size, offset)
        if (r.has("moveTo")) {
          offset = r.getLong("moveTo")
          continue
        }
        if (r.optBoolean("saved") || r.optBoolean("skipped")) return jsonToMap(r)
        offset = r.optLong("offset", offset)
        failures = 0
      } catch (e: Fatal) {
        throw e
      } catch (e: Exception) {
        if (job.cancelled) throw e
        if (failures >= RETRIES) throw IOException("Lost the connection. Tap Carry on when you're back on the Wi-Fi.")
        failures++
        StopBus.send("onUploadProgress", mapOf("jobId" to job.id, "loaded" to offset, "total" to size, "reconnecting" to true, "uploadId" to job.uploadId))
        Thread.sleep(minOf(1000L shl (failures - 1), 15_000L))
        try {
          val (status, text) = Net.request(target, "GET", "/uploads/${job.uploadId}", null, 5000)
          if (status == 404) throw Fatal("That half-sent file is gone there. Send it again.", 404)
          if (status in 200..299) offset = json(text).optLong("offset", offset)
        } catch (f: Fatal) {
          throw f
        } catch (_: Exception) {
          // still unreachable; the next try fails fast or carries on
        }
      }
    }
  }

  private fun skipFully(input: InputStream, count: Long) {
    var left = count
    val buf = ByteArray(64 * 1024)
    while (left > 0) {
      val skipped = input.skip(left)
      if (skipped > 0) {
        left -= skipped
        continue
      }
      val n = input.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
      if (n < 0) throw IOException("The file got shorter")
      left -= n
    }
  }

  private fun put(context: Context, job: Job, target: Target, uri: Uri, size: Long, offset: Long): JSONObject {
    val conn = Net.open(target, "PUT", "/uploads/${job.uploadId}?offset=$offset", 15_000)
    job.conn = conn
    try {
      conn.doOutput = true
      conn.setRequestProperty("Content-Type", "application/octet-stream")
      conn.setFixedLengthStreamingMode(size - offset)
      val input = context.contentResolver.openInputStream(uri) ?: throw Fatal("Couldn't open that file", 0)
      input.use { src ->
        skipFully(src, offset)
        conn.outputStream.use { out ->
          val buf = ByteArray(64 * 1024)
          var sent = offset
          var lastReport = 0L
          while (true) {
            if (job.cancelled) throw IOException("Cancelled")
            val n = src.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
            sent += n
            val now = System.currentTimeMillis()
            if (now - lastReport > 200) {
              lastReport = now
              StopBus.send("onUploadProgress", mapOf("jobId" to job.id, "loaded" to sent, "total" to size, "uploadId" to job.uploadId))
            }
          }
        }
      }
      val status = conn.responseCode
      val text = Net.readAll(if (status >= 400) conn.errorStream else conn.inputStream)
      val r = json(text)
      if (status in 200..299) {
        StopBus.send("onUploadProgress", mapOf("jobId" to job.id, "loaded" to r.optLong("offset", size), "total" to size, "uploadId" to job.uploadId))
        return r
      }
      if (status == 409 && r.has("offset")) return JSONObject().put("moveTo", r.getLong("offset"))
      if (status == 400 || status == 401 || status == 404) throw Fatal(r.optString("error", "Sending failed ($status)"), status)
      throw IOException(r.optString("error", "Sending failed ($status)"))
    } finally {
      conn.disconnect()
      job.conn = null
    }
  }
}
