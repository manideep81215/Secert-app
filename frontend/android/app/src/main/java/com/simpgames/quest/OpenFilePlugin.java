package com.simpgames.quest;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.webkit.MimeTypeMap;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

@CapacitorPlugin(name = "OpenFile")
public class OpenFilePlugin extends Plugin {

  @PluginMethod
  public void openFile(PluginCall call) {
    String rawPath = call.getString("path", "");
    String mimeType = call.getString("mimeType", "application/octet-stream");
    String chooserTitle = call.getString("title", "Open file with");

    if (rawPath == null || rawPath.trim().isEmpty()) {
      call.reject("File path is required.");
      return;
    }

    try {
      String normalizedPath = rawPath.trim();
      if (normalizedPath.startsWith("file://")) {
        normalizedPath = Uri.parse(normalizedPath).getPath();
      }

      if (normalizedPath == null || normalizedPath.isEmpty()) {
        call.reject("Invalid file path.");
        return;
      }

      File file = new File(normalizedPath);
      if (!file.exists()) {
        call.reject("File not found.");
        return;
      }

      String resolvedMimeType = resolveMimeType(file, mimeType);
      Uri contentUri = FileProvider.getUriForFile(
          getContext(),
          getContext().getPackageName() + ".fileprovider",
          file);

      Intent intent = new Intent(Intent.ACTION_VIEW);
      intent.setDataAndType(contentUri, resolvedMimeType);
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

      Intent chooser = Intent.createChooser(intent, chooserTitle);
      chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(chooser);

      JSObject result = new JSObject();
      result.put("opened", true);
      call.resolve(result);
    } catch (ActivityNotFoundException noHandler) {
      call.reject("No app available to open this file.");
    } catch (Exception error) {
      call.reject(error.getMessage() != null ? error.getMessage() : "Unable to open file.");
    }
  }

  private String resolveMimeType(File file, String fallbackMimeType) {
    String safeFallback = (fallbackMimeType == null || fallbackMimeType.trim().isEmpty())
        ? "application/octet-stream"
        : fallbackMimeType.trim();

    String extension = MimeTypeMap.getFileExtensionFromUrl(file.getName());
    if (extension == null || extension.trim().isEmpty()) {
      return safeFallback;
    }

    String guessed = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.toLowerCase());
    return (guessed == null || guessed.trim().isEmpty()) ? safeFallback : guessed;
  }
}
