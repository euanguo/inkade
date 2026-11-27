const { withMainActivity } = require("expo/config-plugins");

const SHARE_HELPER_COMMENT = "// @generated inkade-share-intent";

function addImport(src, importLine) {
  if (src.includes(importLine)) return src;
  return src.replace(
    /package\s+[^\n]+\n/,
    (match) => `${match}${importLine}\n`,
  );
}

/**
 * Normalizes Android `ACTION_SEND` (`text/*`) share intents into `inkade://capture` deep links so
 * `expo-router` & `expo-linking` receive shared `text`, `url`, and `title` on cold and warm starts.
 */
function withAndroidShareIntent(config) {
  return withMainActivity(config, (mod) => {
    if (mod.modResults.language !== "kt") {
      return mod;
    }

    let contents = mod.modResults.contents;
    if (contents.includes(SHARE_HELPER_COMMENT)) {
      return mod;
    }

    contents = addImport(contents, "import android.content.Intent");
    contents = addImport(contents, "import android.net.Uri");

    const normalizeFn = `
  ${SHARE_HELPER_COMMENT}
  private fun normalizeShareIntent(incoming: Intent?): Intent? {
    if (incoming == null || incoming.action != Intent.ACTION_SEND) return null
    val mimeType = incoming.type ?: return null
    if (!mimeType.startsWith("text/")) return null

    val sharedText = incoming.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty()
    val sharedSubject = incoming.getStringExtra(Intent.EXTRA_SUBJECT)?.trim().orEmpty()
    if (sharedText.isEmpty() && sharedSubject.isEmpty()) return null

    val extractedUrl = Regex("https?://\\\\S+").find(sharedText)?.value
      ?.trimEnd(')', ',', '.', ';', '!', '?')
    val uriBuilder = Uri.Builder()
      .scheme("inkade")
      .authority("capture")
    if (sharedText.isNotEmpty()) uriBuilder.appendQueryParameter("text", sharedText)
    if (sharedSubject.isNotEmpty()) uriBuilder.appendQueryParameter("title", sharedSubject)
    if (!extractedUrl.isNullOrEmpty()) uriBuilder.appendQueryParameter("url", extractedUrl)

    return Intent(Intent.ACTION_VIEW, uriBuilder.build()).apply {
      setClass(this@MainActivity, MainActivity::class.java)
      addFlags(incoming.flags)
    }
  }

  override fun onNewIntent(intent: Intent) {
    val normalized = normalizeShareIntent(intent) ?: intent
    setIntent(normalized)
    super.onNewIntent(normalized)
  }
`;

    contents = contents.replace(
      "    super.onCreate(null)",
      "    normalizeShareIntent(intent)?.let { setIntent(it) }\n    super.onCreate(null)",
    );

    contents = contents.replace(
      "  override fun getMainComponentName()",
      `${normalizeFn}\n  override fun getMainComponentName()`,
    );

    mod.modResults.contents = contents;
    return mod;
  });
}

module.exports = withAndroidShareIntent;
