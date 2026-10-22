package expo.modules.courierstop

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.security.SecureRandom

class CourierFileProvider : FileProvider()

internal data class Saved(val uri: String, val name: String, val mime: String, val size: Long)

/**
 * Half-received files wait in the app's cache as <id>.part with an
 * <id>.json beside it, so a dropped connection (or the app being closed)
 * loses nothing: the sender asks how far it got and carries on. Finished
 * files move to Downloads/Courier, where the Files app and Gallery see
 * them. Same protocol as the PC (agent/src/uploads.js).
 */
internal object Partials {
  private const val KEEP_MS = 24 * 60 * 60 * 1000L

  fun dir(context: Context): File = File(context.cacheDir, "courier-partials").apply { mkdirs() }

  fun part(context: Context, id: String) = File(dir(context), "$id.part")

  private fun metaFile(context: Context, id: String) = File(dir(context), "$id.json")

  fun create(context: Context, name: String, size: Long, from: String?): String {
    val bytes = ByteArray(16)
    SecureRandom().nextBytes(bytes)
    val id = bytes.joinToString("") { String.format("%02x", it.toInt() and 0xff) }
    part(context, id).writeBytes(ByteArray(0))
    metaFile(context, id).writeText(JSONObject().put("name", name).put("size", size).put("from", from ?: JSONObject.NULL).toString())
    return id
  }

  fun meta(context: Context, id: String): JSONObject? {
    if (!Regex("^[a-f0-9]{32}$").matches(id)) return null
    return try {
      JSONObject(metaFile(context, id).readText())
    } catch (_: Exception) {
      null
    }
  }

  fun remove(context: Context, id: String) {
    part(context, id).delete()
    metaFile(context, id).delete()
  }

  fun sweep(context: Context) {
    val cutoff = System.currentTimeMillis() - KEEP_MS
    dir(context).listFiles()?.forEach { if (it.lastModified() < cutoff) it.delete() }
  }
}

/** A name another stop sent, made safe to save: no folders, no oddities. */
internal fun safeName(raw: String?): String? {
  val base = (raw ?: "").substringAfterLast('/').substringAfterLast('\\').filter { it >= ' ' && it != ':' && it != '*' && it != '?' && it != '"' && it != '<' && it != '>' && it != '|' }.trim()
  if (base.isEmpty() || base == "." || base == "..") return null
  return base.take(150)
}

internal object Saver {
  fun mimeOf(name: String): String {
    val ext = name.substringAfterLast('.', "").lowercase()
    return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
  }

  /** Moves a finished upload into Downloads/Courier. Android picks a new
   * name ("photo (1).jpg") when one with the same name is already there. */
  fun save(context: Context, part: File, name: String): Saved {
    val mime = mimeOf(name)
    val size = part.length()
    if (Build.VERSION.SDK_INT >= 29) {
      val resolver = context.contentResolver
      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, name)
        put(MediaStore.MediaColumns.MIME_TYPE, mime)
        put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Courier")
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }
      val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        ?: throw IOException("Could not save to Downloads")
      try {
        val out = resolver.openOutputStream(uri) ?: throw IOException("Could not write to Downloads")
        out.use { o -> part.inputStream().use { it.copyTo(o, 256 * 1024) } }
        val done = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
        resolver.update(uri, done, null, null)
      } catch (e: Exception) {
        resolver.delete(uri, null, null)
        throw e
      }
      part.delete()
      return Saved(uri.toString(), shownName(context, uri) ?: name, mime, size)
    }

    // Android 9 and older: the app's own Download/Courier folder, which
    // needs no storage permission.
    val dir = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Courier").apply { mkdirs() }
    val dot = name.lastIndexOf('.')
    val stem = if (dot > 0) name.substring(0, dot) else name
    val ext = if (dot > 0) name.substring(dot) else ""
    var target = File(dir, name)
    var n = 1
    while (target.exists()) {
      target = File(dir, "$stem ($n)$ext")
      n++
    }
    part.copyTo(target)
    part.delete()
    val uri = FileProvider.getUriForFile(context, context.packageName + ".courierfiles", target)
    return Saved(uri.toString(), target.name, mime, size)
  }

  private fun shownName(context: Context, uri: Uri): String? = try {
    context.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)?.use { c ->
      if (c.moveToFirst()) c.getString(0) else null
    }
  } catch (_: Exception) {
    null
  }
}
