package expo.modules.courierstop

import java.security.SecureRandom

/**
 * Another stop asking this phone to pair (the phone's side of
 * agent/src/handshake.js): both screens show the same 4-digit code and the
 * person taps Allow here. Kept in memory for two minutes.
 */
internal object PairRequests {
  private const val TTL_MS = 2 * 60 * 1000L
  private const val MAX_PENDING = 3
  private const val MAX_PER_MINUTE = 6

  class Req(val requestId: String, val code: String, val peer: Map<String, Any?>, var state: String, val at: Long)

  private val requests = LinkedHashMap<String, Req>()
  private val recent = ArrayDeque<Long>()
  private val random = SecureRandom()

  /** Checks and trims what another stop says about itself. */
  fun readPeer(body: Map<String, Any?>, ip: String): Map<String, Any?>? {
    fun str(v: Any?, max: Int) = (v as? String)?.trim()?.takeIf { it.isNotEmpty() && it.length <= max }
    val id = str(body["id"], 80) ?: return null
    val name = str(body["name"], 80) ?: return null
    val token = str(body["token"], 200) ?: return null
    val port = num(body["port"])?.takeIf { it in 1..65535 } ?: return null
    val peer = mutableMapOf<String, Any?>(
      "id" to id, "name" to name, "kind" to (if (body["kind"] == "phone") "phone" else "pc"),
      "ip" to ip, "port" to port, "token" to token,
    )
    val securePort = num(body["securePort"])
    val fingerprint = str(body["fingerprint"], 200)
    if (securePort != null && securePort in 1..65535 && fingerprint != null) {
      peer["securePort"] = securePort
      peer["fingerprint"] = fingerprint
    }
    return peer
  }

  @Synchronized
  private fun expireOld(onExpired: (Req) -> Unit) {
    val now = System.currentTimeMillis()
    val it = requests.values.iterator()
    while (it.hasNext()) {
      val r = it.next()
      if (r.state == "waiting" && now - r.at > TTL_MS) {
        r.state = "expired"
        onExpired(r)
      }
      if (now - r.at > TTL_MS * 2) it.remove()
    }
  }

  /** Returns the new request, or a reason it was refused. */
  @Synchronized
  fun create(peer: Map<String, Any?>, onExpired: (Req) -> Unit): Pair<Req?, String?> {
    expireOld(onExpired)
    val now = System.currentTimeMillis()
    while (recent.isNotEmpty() && now - recent.first() > 60_000) recent.removeFirst()
    val waiting = requests.values.filter { it.state == "waiting" }
    if (recent.size >= MAX_PER_MINUTE || waiting.size >= MAX_PENDING) return Pair(null, "Too many pairing requests. Wait a minute.")
    recent.addLast(now)
    // The same asker trying again replaces its own earlier request.
    for (r in waiting) if (r.peer["id"] == peer["id"]) {
      r.state = "expired"
      onExpired(r)
    }
    val bytes = ByteArray(16)
    random.nextBytes(bytes)
    val requestId = bytes.joinToString("") { String.format("%02x", it.toInt() and 0xff) }
    val code = String.format("%04d", random.nextInt(10000))
    val r = Req(requestId, code, peer, "waiting", now)
    requests[requestId] = r
    return Pair(r, null)
  }

  /** "Allowed yet?" from the asker. The token goes out once. */
  @Synchronized
  fun status(requestId: String, onExpired: (Req) -> Unit): String {
    expireOld(onExpired)
    val r = requests[requestId] ?: return "expired"
    if (r.state == "allowed") requests.remove(requestId)
    return r.state
  }

  /** The person tapped Allow or Deny. Returns the asker when allowed. */
  @Synchronized
  fun answer(requestId: String, allow: Boolean): Map<String, Any?>? {
    val r = requests[requestId] ?: return null
    if (r.state != "waiting") return null
    r.state = if (allow) "allowed" else "denied"
    return if (allow) r.peer else null
  }

  @Synchronized
  fun pending(): List<Map<String, Any?>> {
    val now = System.currentTimeMillis()
    return requests.values.filter { it.state == "waiting" && now - it.at <= TTL_MS }.map {
      mapOf("requestId" to it.requestId, "code" to it.code, "name" to it.peer["name"], "kind" to it.peer["kind"], "ip" to it.peer["ip"])
    }
  }
}
