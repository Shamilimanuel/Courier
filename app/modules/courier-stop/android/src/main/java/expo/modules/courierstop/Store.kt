package expo.modules.courierstop

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import java.util.UUID

private const val PREFS = "courier_stop"

internal fun prefs(context: Context): SharedPreferences =
  context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

/** Events for the app's screens, when they are open. */
internal object StopBus {
  @Volatile var emit: ((String, Map<String, Any?>) -> Unit)? = null

  fun send(name: String, body: Map<String, Any?>) {
    try {
      emit?.invoke(name, body)
    } catch (_: Throwable) {
      // the screens are gone; the notification still tells the person
    }
  }
}

/** This phone as a stop: an id that never changes, the token other stops
 * need to send here, a name, the port it listens on, and whether it runs. */
internal object StopConfig {
  const val DEFAULT_PORT = 5544

  fun id(context: Context): String {
    val p = prefs(context)
    p.getString("id", null)?.let { return it }
    val id = UUID.randomUUID().toString()
    p.edit().putString("id", id).apply()
    return id
  }

  fun token(context: Context): String {
    val p = prefs(context)
    p.getString("token", null)?.let { return it }
    val bytes = ByteArray(24)
    SecureRandom().nextBytes(bytes)
    val token = bytes.joinToString("") { String.format("%02x", it.toInt() and 0xff) }
    p.edit().putString("token", token).apply()
    return token
  }

  fun name(context: Context): String {
    prefs(context).getString("name", null)?.let { if (it.isNotBlank()) return it }
    val device = try {
      Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME)
    } catch (_: Exception) {
      null
    }
    return device?.takeIf { it.isNotBlank() } ?: Build.MODEL ?: "Phone"
  }

  fun setName(context: Context, name: String) {
    prefs(context).edit().putString("name", name.trim().take(60)).apply()
  }

  fun port(context: Context): Int = prefs(context).getInt("port", DEFAULT_PORT)

  fun setPort(context: Context, port: Int) {
    prefs(context).edit().putInt("port", port).apply()
  }

  fun enabled(context: Context): Boolean = prefs(context).getBoolean("enabled", false)

  fun setEnabled(context: Context, on: Boolean) {
    prefs(context).edit().putBoolean("enabled", on).apply()
  }

  /** Who this phone is, as told to other stops when pairing. */
  fun self(context: Context): Map<String, Any?> = mapOf(
    "id" to id(context),
    "name" to name(context),
    "kind" to "phone",
    "port" to port(context),
    "token" to token(context),
  )
}

/**
 * What this phone knows about the stops it is paired with. The app keeps
 * the real list; it shares the names here (setNames) so a notification can
 * say who sent something. Two inboxes for the app to pick up when it opens:
 * stops that introduced themselves, and new addresses stops were seen at.
 */
internal object Peers {
  fun setNames(context: Context, list: List<Map<String, Any?>>) {
    val o = JSONObject()
    for (p in list) {
      val id = p["peerId"] as? String ?: continue
      o.put(id, p["name"] as? String ?: "")
    }
    prefs(context).edit().putString("peerNames", o.toString()).apply()
  }

  fun nameOf(context: Context, id: String?): String? {
    if (id.isNullOrBlank()) return null
    val o = JSONObject(prefs(context).getString("peerNames", "{}") ?: "{}")
    return o.optString(id).takeIf { it.isNotBlank() }
  }

  @Synchronized
  fun rememberAddress(context: Context, id: String, ip: String) {
    val p = prefs(context)
    val o = JSONObject(p.getString("peerAddresses", "{}") ?: "{}")
    if (o.optString(id) == ip) return
    o.put(id, ip)
    p.edit().putString("peerAddresses", o.toString()).apply()
  }

  fun addresses(context: Context): Map<String, Any?> = jsonToMap(JSONObject(prefs(context).getString("peerAddresses", "{}") ?: "{}"))

  @Synchronized
  fun addIntroduced(context: Context, peer: Map<String, Any?>) {
    val p = prefs(context)
    val list = JSONArray(p.getString("introduced", "[]") ?: "[]")
    list.put(JSONObject(peer))
    p.edit().putString("introduced", list.toString()).apply()
  }

  /** Hands the waiting introductions to the app, once. */
  @Synchronized
  fun takeIntroduced(context: Context): List<Map<String, Any?>> {
    val p = prefs(context)
    val list = JSONArray(p.getString("introduced", "[]") ?: "[]")
    p.edit().putString("introduced", "[]").apply()
    return jsonToList(list)
  }
}

/** What arrived on this phone: files (with where they were saved) and
 * messages. Newest first, the last 100. */
internal object Inbox {
  private const val MAX = 100

  @Synchronized
  fun add(context: Context, entry: Map<String, Any?>) {
    val p = prefs(context)
    val old = JSONArray(p.getString("inbox", "[]") ?: "[]")
    val next = JSONArray()
    next.put(JSONObject(entry))
    for (i in 0 until minOf(old.length(), MAX - 1)) next.put(old.get(i))
    p.edit().putString("inbox", next.toString()).apply()
  }

  fun list(context: Context): List<Map<String, Any?>> = jsonToList(JSONArray(prefs(context).getString("inbox", "[]") ?: "[]"))

  @Synchronized
  fun remove(context: Context, id: String) {
    val p = prefs(context)
    val old = JSONArray(p.getString("inbox", "[]") ?: "[]")
    val next = JSONArray()
    for (i in 0 until old.length()) {
      val o = old.optJSONObject(i) ?: continue
      if (o.optString("id") != id) next.put(o)
    }
    p.edit().putString("inbox", next.toString()).apply()
  }
}

internal fun jsonToMap(o: JSONObject): Map<String, Any?> {
  val out = HashMap<String, Any?>()
  val keys = o.keys()
  while (keys.hasNext()) {
    val k = keys.next()
    out[k] = jsonValue(o.opt(k))
  }
  return out
}

internal fun jsonToList(a: JSONArray): List<Map<String, Any?>> {
  val out = ArrayList<Map<String, Any?>>()
  for (i in 0 until a.length()) a.optJSONObject(i)?.let { out.add(jsonToMap(it)) }
  return out
}

private fun jsonValue(v: Any?): Any? = when (v) {
  null, JSONObject.NULL -> null
  is JSONObject -> jsonToMap(v)
  is JSONArray -> (0 until v.length()).map { jsonValue(v.opt(it)) }
  else -> v
}

internal fun num(v: Any?): Int? = when (v) {
  is Number -> v.toInt()
  is String -> v.trim().toIntOrNull()
  else -> null
}
