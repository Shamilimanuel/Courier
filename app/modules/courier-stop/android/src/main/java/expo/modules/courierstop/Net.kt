package expo.modules.courierstop

import android.content.Context
import android.net.ConnectivityManager
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.X509TrustManager

/** Where to reach another stop. A PC also has an HTTPS port and its
 * certificate's fingerprint: then every call goes over HTTPS pinned to that
 * fingerprint (no certificate authority; the pin came with pairing), so
 * nobody else on the Wi-Fi can read the token or the files. */
internal data class Target(val ip: String, val port: Int, val token: String?, val securePort: Int?, val fingerprint: String?) {
  val secure get() = securePort != null && !fingerprint.isNullOrBlank()

  companion object {
    fun from(map: Map<String, Any?>): Target {
      val ip = map["ip"] as? String ?: throw IllegalArgumentException("No address")
      val port = num(map["port"]) ?: throw IllegalArgumentException("No port")
      return Target(ip, port, map["token"] as? String, num(map["securePort"]), map["fingerprint"] as? String)
    }
  }
}

internal class NetException(message: String, val status: Int = 0) : Exception(message)

internal object Net {
  private const val TIMEOUT_MS = 8000
  @Volatile var selfId: String? = null

  fun fingerprintOf(cert: X509Certificate): String =
    MessageDigest.getInstance("SHA-256").digest(cert.encoded).joinToString(":") { String.format("%02X", it.toInt() and 0xff) }

  private fun pinnedFactory(fingerprint: String): SSLSocketFactory {
    val want = fingerprint.uppercase()
    val trust = object : X509TrustManager {
      override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
        throw CertificateException("not used")
      }

      override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        if (chain.isEmpty() || fingerprintOf(chain[0]) != want) {
          throw CertificateException("The PC's certificate changed. Pair again if you reinstalled Courier there.")
        }
      }

      override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    }
    val ctx = SSLContext.getInstance("TLS")
    ctx.init(null, arrayOf(trust), SecureRandom())
    return ctx.socketFactory
  }

  fun open(t: Target, method: String, path: String, timeoutMs: Int = TIMEOUT_MS): HttpURLConnection {
    val url = if (t.secure) URL("https", t.ip, t.securePort!!, path) else URL("http", t.ip, t.port, path)
    val conn = url.openConnection() as HttpURLConnection
    if (conn is HttpsURLConnection) {
      conn.sslSocketFactory = pinnedFactory(t.fingerprint!!)
      conn.hostnameVerifier = HostnameVerifier { _, _ -> true }
    }
    conn.requestMethod = method
    conn.connectTimeout = timeoutMs
    conn.readTimeout = timeoutMs
    conn.useCaches = false
    conn.instanceFollowRedirects = false
    t.token?.let { conn.setRequestProperty("Authorization", "Bearer $it") }
    selfId?.let { conn.setRequestProperty("X-Courier-From", it) }
    return conn
  }

  fun readAll(stream: InputStream?): String {
    if (stream == null) return ""
    val out = ByteArrayOutputStream()
    stream.use { it.copyTo(out) }
    return out.toString("UTF-8")
  }

  /** One JSON call: returns (status, body text). Throws only when the
   * stop can't be reached at all. */
  fun request(t: Target, method: String, path: String, body: String?, timeoutMs: Int = TIMEOUT_MS): Pair<Int, String> {
    val conn = open(t, method, path, timeoutMs)
    try {
      if (body != null) {
        val bytes = body.toByteArray(Charsets.UTF_8)
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setFixedLengthStreamingMode(bytes.size)
        conn.outputStream.use { it.write(bytes) }
      }
      val status = conn.responseCode
      val text = readAll(if (status >= 400) conn.errorStream else conn.inputStream)
      return Pair(status, text)
    } catch (e: java.net.SocketTimeoutException) {
      throw NetException("Timed out reaching ${t.ip}. Is it on the same Wi-Fi, and is your phone off VPN and mobile data?")
    } catch (e: javax.net.ssl.SSLException) {
      throw NetException(e.cause?.message ?: e.message ?: "Secure connection failed")
    } catch (e: java.io.IOException) {
      throw NetException("Could not reach ${t.ip}:${if (t.secure) t.securePort else t.port}. Is Courier running there?")
    } finally {
      conn.disconnect()
    }
  }

  /** The fingerprint a PC's HTTPS port shows, to pin from now on. Used once
   * for stops paired before the phone pinned anything. */
  fun probeFingerprint(ip: String, port: Int): String {
    val ctx = SSLContext.getInstance("TLS")
    var seen: X509Certificate? = null
    val trust = object : X509TrustManager {
      override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
      override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        seen = chain.firstOrNull()
      }
      override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    }
    ctx.init(null, arrayOf(trust), SecureRandom())
    val socket = ctx.socketFactory.createSocket() as SSLSocket
    try {
      socket.soTimeout = TIMEOUT_MS
      socket.connect(InetSocketAddress(ip, port), TIMEOUT_MS)
      socket.startHandshake()
    } finally {
      try {
        socket.close()
      } catch (_: Exception) {
      }
    }
    return fingerprintOf(seen ?: throw NetException("No certificate"))
  }

  /** This phone's address on the Wi-Fi and the network's size, for the
   * "knock on every address" fallback when finding stops. */
  fun wifiAddress(context: Context): Map<String, Any?>? {
    val cm = context.getSystemService(ConnectivityManager::class.java) ?: return null
    val network = cm.activeNetwork ?: return null
    val props = cm.getLinkProperties(network) ?: return null
    val link = props.linkAddresses.firstOrNull { it.address is Inet4Address && !it.address.isLoopbackAddress } ?: return null
    return mapOf("ip" to link.address.hostAddress, "prefix" to link.prefixLength)
  }
}
