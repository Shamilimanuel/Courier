package expo.modules.courierstop

import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat

/**
 * Keeps this phone ready to receive: runs the small server, announces the
 * phone on the Wi-Fi (mDNS, "_courier._tcp", like the PCs do) and holds
 * the quiet "Courier is ready" notification Android requires for anything
 * that keeps running with the app closed.
 */
class StopService : Service() {
  companion object {
    @Volatile var running = false
      private set
    private var server: StopServer? = null

    fun start(context: Context) {
      ContextCompat.startForegroundService(context, Intent(context, StopService::class.java))
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, StopService::class.java))
    }
  }

  private var nsd: NsdManager? = null
  private var registration: NsdManager.RegistrationListener? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      val note = Notes.ready(this)
      if (Build.VERSION.SDK_INT >= 29) {
        startForeground(Notes.READY_ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
      } else {
        startForeground(Notes.READY_ID, note)
      }
    } catch (_: Exception) {
      // Android refused (e.g. started from the background): try again the
      // next time the app opens.
      stopSelf()
      return START_NOT_STICKY
    }

    if (server == null) {
      try {
        val s = StopServer(applicationContext)
        StopConfig.setPort(this, s.start(StopConfig.DEFAULT_PORT))
        server = s
      } catch (_: Exception) {
        stopSelf()
        return START_NOT_STICKY
      }
    }
    Net.selfId = StopConfig.id(this)
    announce()
    running = true
    return START_STICKY
  }

  /** (Re)announces the phone on the Wi-Fi, e.g. after its name changed. */
  private fun announce() {
    unannounce()
    val info = NsdServiceInfo().apply {
      serviceName = StopConfig.name(this@StopService)
      serviceType = "_courier._tcp"
      port = StopConfig.port(this@StopService)
      setAttribute("id", StopConfig.id(this@StopService))
      setAttribute("name", StopConfig.name(this@StopService))
      setAttribute("kind", "phone")
      setAttribute("v", "2")
    }
    val listener = object : NsdManager.RegistrationListener {
      override fun onServiceRegistered(serviceInfo: NsdServiceInfo) {}
      override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {}
      override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) {}
      override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {}
    }
    try {
      val manager = getSystemService(NsdManager::class.java)
      manager.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
      nsd = manager
      registration = listener
    } catch (_: Exception) {
      // Without the announcement the address sweep and the QR code still work.
    }
  }

  private fun unannounce() {
    val l = registration ?: return
    try {
      nsd?.unregisterService(l)
    } catch (_: Exception) {
    }
    registration = null
  }

  override fun onDestroy() {
    unannounce()
    server?.stop()
    server = null
    running = false
    super.onDestroy()
  }
}

/** Starts Courier's listening again after the phone restarts or the app
 * updates, if it was on. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    if (!StopConfig.enabled(context)) return
    try {
      StopService.start(context)
    } catch (_: Exception) {
      // Android said no; it starts when the app is opened
    }
  }
}
