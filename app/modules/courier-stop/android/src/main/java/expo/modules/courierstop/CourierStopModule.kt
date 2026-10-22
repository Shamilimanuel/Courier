package expo.modules.courierstop

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors

/**
 * What the app's screens can ask of this phone's stop. The listening part
 * lives in StopService (it keeps running with the app closed); this is the
 * bridge to it, plus the network calls that pin a PC's certificate.
 */
class CourierStopModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "No app context" }
  private val io = Executors.newCachedThreadPool()
  private var finder: Finder? = null

  override fun definition() = ModuleDefinition {
    Name("CourierStop")

    Events(
      "onFileArrived", "onTextArrived", "onPairRequest", "onPairSettled", "onPeerSeen", "onPeerIntroduced",
      "onFound", "onLost", "onUploadProgress", "onUploadDone", "onUploadError",
    )

    OnCreate {
      StopBus.emit = { name, body -> sendEvent(name, body) }
      Net.selfId = StopConfig.id(context)
    }

    OnDestroy {
      StopBus.emit = null
      finder?.stop()
      finder = null
    }

    // ------------------------------------------------------ this stop --
    Function("identity") {
      StopConfig.self(context) + mapOf("running" to StopService.running, "enabled" to StopConfig.enabled(context))
    }

    Function("setName") { name: String ->
      StopConfig.setName(context, name)
      if (StopService.running) StopService.start(context)
    }

    Function("start") {
      StopConfig.setEnabled(context, true)
      StopService.start(context)
    }

    Function("stop") {
      StopConfig.setEnabled(context, false)
      StopService.stop(context)
    }

    Function("setPeers") { list: List<Map<String, Any?>> ->
      Peers.setNames(context, list)
    }

    Function("getPeerAddresses") {
      Peers.addresses(context)
    }

    Function("takeIntroductions") {
      Peers.takeIntroduced(context)
    }

    // ----------------------------------------------------- arrivals --
    Function("getInbox") {
      Inbox.list(context)
    }

    Function("removeFromInbox") { id: String ->
      Inbox.remove(context, id)
    }

    AsyncFunction("openFile") { uri: String, mime: String? ->
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(Uri.parse(uri), mime ?: "*/*")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      try {
        context.startActivity(intent)
        true
      } catch (_: ActivityNotFoundException) {
        false
      }
    }

    // ------------------------------------------------------ pairing --
    Function("getPendingPairs") {
      PairRequests.pending()
    }

    Function("answerPair") { requestId: String, allow: Boolean ->
      Notes.cancelPairRequest(context, requestId)
      PairRequests.answer(requestId, allow)
    }

    // ------------------------------------------------------ finding --
    Function("startFinding") {
      val f = finder ?: Finder(context).also { finder = it }
      f.start()
    }

    Function("stopFinding") {
      finder?.stop()
    }

    Function("wifiAddress") {
      Net.wifiAddress(context)
    }

    // ------------------------------------------------- talking to stops --
    AsyncFunction("request") { target: Map<String, Any?>, method: String, path: String, body: String?, promise: Promise ->
      io.execute {
        try {
          val (status, text) = Net.request(Target.from(target), method, path, body)
          promise.resolve(mapOf("status" to status, "body" to text))
        } catch (e: Exception) {
          promise.reject("E_COURIER_NET", e.message ?: "Could not reach that stop", e)
        }
      }
    }

    AsyncFunction("probeFingerprint") { ip: String, port: Int, promise: Promise ->
      io.execute {
        try {
          promise.resolve(Net.probeFingerprint(ip, port))
        } catch (e: Exception) {
          promise.reject("E_COURIER_NET", e.message ?: "No secure port there", e)
        }
      }
    }

    Function("upload") { jobId: String, target: Map<String, Any?>, uri: String, name: String, size: Double, onDuplicate: String?, resumeUploadId: String? ->
      Uploader.start(context, jobId, Target.from(target), uri, name, size.toLong(), onDuplicate, resumeUploadId)
    }

    Function("cancelUpload") { jobId: String ->
      Uploader.cancel(jobId)
    }

    // ------------------------------------------------------ battery --
    Function("isIgnoringBatteryOptimizations") {
      val pm = context.getSystemService(PowerManager::class.java)
      pm?.isIgnoringBatteryOptimizations(context.packageName) ?: false
    }

    Function("askBatteryExemption") {
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + context.packageName))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        context.startActivity(intent)
        true
      } catch (_: Exception) {
        try {
          context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          true
        } catch (_: Exception) {
          false
        }
      }
    }
  }
}
