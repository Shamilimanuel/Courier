package expo.modules.courierstop

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import java.net.Inet4Address

/**
 * Looks for other stops announcing "_courier._tcp" on the Wi-Fi (PCs and
 * phones running Courier). Each one found is looked up for its address one
 * at a time (older Android can only do one lookup at once) and reported as
 * onFound { id, name, kind, ip, port, securePort? }.
 */
internal class Finder(private val context: Context) {
  private val nsd = context.getSystemService(NsdManager::class.java)
  private var listener: NsdManager.DiscoveryListener? = null
  private var multicast: WifiManager.MulticastLock? = null
  private val queue = ArrayDeque<NsdServiceInfo>()
  private var resolving = false
  private val idsByService = HashMap<String, String>()

  fun start() {
    if (listener != null) return
    // Some phones only pass on the Wi-Fi's announcements while an app
    // holds this; let go in stop().
    try {
      multicast = context.applicationContext.getSystemService(WifiManager::class.java)
        ?.createMulticastLock("courier:find")?.apply {
          setReferenceCounted(false)
          acquire()
        }
    } catch (_: Exception) {
    }
    val l = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(serviceType: String) {}
      override fun onDiscoveryStopped(serviceType: String) {}
      override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {}
      override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
      override fun onServiceFound(info: NsdServiceInfo) {
        enqueue(info)
      }

      override fun onServiceLost(info: NsdServiceInfo) {
        val id = synchronized(idsByService) { idsByService.remove(info.serviceName) } ?: return
        StopBus.send("onLost", mapOf("id" to id))
      }
    }
    try {
      nsd?.discoverServices("_courier._tcp", NsdManager.PROTOCOL_DNS_SD, l)
      listener = l
    } catch (_: Exception) {
    }
  }

  fun stop() {
    listener?.let {
      try {
        nsd?.stopServiceDiscovery(it)
      } catch (_: Exception) {
      }
    }
    listener = null
    try {
      multicast?.release()
    } catch (_: Exception) {
    }
    multicast = null
    synchronized(queue) { queue.clear() }
  }

  private fun enqueue(info: NsdServiceInfo) {
    synchronized(queue) {
      queue.addLast(info)
      if (resolving) return
      resolving = true
    }
    next()
  }

  private fun next() {
    val info = synchronized(queue) {
      val i = queue.removeFirstOrNull()
      if (i == null) resolving = false
      i
    } ?: return
    try {
      @Suppress("DEPRECATION")
      nsd?.resolveService(info, object : NsdManager.ResolveListener {
        override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
          next()
        }

        override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
          report(serviceInfo)
          next()
        }
      })
    } catch (_: Exception) {
      next()
    }
  }

  private fun report(info: NsdServiceInfo) {
    val attrs = info.attributes ?: emptyMap()
    fun attr(k: String) = attrs[k]?.let { String(it, Charsets.UTF_8) }
    val id = attr("id") ?: return
    if (id == StopConfig.id(context)) return
    @Suppress("DEPRECATION")
    val host = info.host
    val ip = (host as? Inet4Address)?.hostAddress ?: host?.hostAddress?.takeIf { !it.contains(':') } ?: return
    synchronized(idsByService) { idsByService[info.serviceName] = id }
    val found = mutableMapOf<String, Any?>(
      "id" to id,
      "name" to (attr("name") ?: info.serviceName),
      "kind" to (if (attr("kind") == "phone") "phone" else "pc"),
      "ip" to ip,
      "port" to info.port,
    )
    attr("sp")?.toIntOrNull()?.let { found["securePort"] = it }
    StopBus.send("onFound", found)
  }
}
