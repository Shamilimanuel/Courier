package expo.modules.courierstop

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * The phone's notifications: the quiet one that keeps Courier ready, one
 * per arrival (file or message), and one when another stop asks to pair.
 */
internal object Notes {
  const val READY_ID = 5544
  private const val CH_READY = "courier_ready"
  private const val CH_ARRIVALS = "courier_arrivals"
  private const val CH_PAIRING = "courier_pairing"
  private var nextId = 6000

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val nm = context.getSystemService(NotificationManager::class.java) ?: return
    nm.createNotificationChannel(
      NotificationChannel(CH_READY, "Ready to receive", NotificationManager.IMPORTANCE_MIN).apply {
        description = "Keeps Courier listening so phones and PCs on this Wi-Fi can send to you."
        setShowBadge(false)
      }
    )
    nm.createNotificationChannel(
      NotificationChannel(CH_ARRIVALS, "Arrivals", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "A file or message arrived."
      }
    )
    nm.createNotificationChannel(
      NotificationChannel(CH_PAIRING, "Pairing", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "Another phone or PC wants to pair."
      }
    )
  }

  private fun openApp(context: Context, requestCode: Int): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(context, requestCode, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  fun ready(context: Context): Notification {
    ensureChannels(context)
    return NotificationCompat.Builder(context, CH_READY)
      .setSmallIcon(R.drawable.courier_notification)
      .setContentTitle("Courier is ready")
      .setContentText("Phones and PCs on this Wi-Fi can send to you")
      .setOngoing(true)
      .setShowWhen(false)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setContentIntent(openApp(context, 1))
      .build()
  }

  private fun post(context: Context, id: Int, n: Notification) {
    try {
      NotificationManagerCompat.from(context).notify(id, n)
    } catch (_: SecurityException) {
      // notifications are off for Courier; the app still lists the arrival
    }
  }

  fun fileArrived(context: Context, name: String, from: String?, size: Long, uri: String, mime: String) {
    ensureChannels(context)
    val view = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(Uri.parse(uri), mime)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    val id = synchronized(this) { nextId++ }
    val tap = PendingIntent.getActivity(context, id, view, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val n = NotificationCompat.Builder(context, CH_ARRIVALS)
      .setSmallIcon(R.drawable.courier_notification)
      .setContentTitle("$name arrived")
      .setContentText(listOfNotNull(from?.let { "From $it" }, formatSize(size), "in Downloads/Courier").joinToString(" · "))
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setContentIntent(tap)
      .addAction(0, "Open", tap)
      .addAction(0, "Courier", openApp(context, id + 1))
      .build()
    post(context, id, n)
  }

  fun textArrived(context: Context, text: String, kind: String, from: String?) {
    ensureChannels(context)
    val id = synchronized(this) { nextId++ }
    val title = (if (kind == "text") "Message" else "Clipboard") + (from?.let { " from $it" } ?: "")
    val n = NotificationCompat.Builder(context, CH_ARRIVALS)
      .setSmallIcon(R.drawable.courier_notification)
      .setContentTitle(title)
      .setContentText(text)
      .setSubText("Copied")
      .setStyle(NotificationCompat.BigTextStyle().bigText(text))
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setContentIntent(openApp(context, id))
      .build()
    post(context, id, n)
  }

  fun pairRequest(context: Context, requestId: String, name: String, code: String) {
    ensureChannels(context)
    val n = NotificationCompat.Builder(context, CH_PAIRING)
      .setSmallIcon(R.drawable.courier_notification)
      .setContentTitle("$name wants to pair")
      .setContentText("Code $code. Tap to allow it.")
      .setAutoCancel(true)
      .setTimeoutAfter(2 * 60 * 1000L)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setContentIntent(openApp(context, 2))
      .build()
    post(context, requestId.hashCode(), n)
  }

  fun cancelPairRequest(context: Context, requestId: String) {
    NotificationManagerCompat.from(context).cancel(requestId.hashCode())
  }

  fun formatSize(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val units = arrayOf("KB", "MB", "GB")
    var v = bytes / 1024.0
    var u = 0
    while (v >= 1024 && u < units.size - 1) {
      v /= 1024
      u++
    }
    return (if (v < 10) String.format("%.1f", v) else String.format("%.0f", v)) + " " + units[u]
  }
}
