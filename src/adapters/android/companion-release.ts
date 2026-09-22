import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import os from "node:os";
// @ts-expect-error -- app-info-parser ships no type declarations.
import AppInfoParser from "app-info-parser";

/**
 * Resolves the HTTP Tools Android companion APK the way HTTP Toolkit resolves
 * its own Android app: fetch the latest build from GitHub Releases, cache it
 * locally, and fall back to a locally-built APK (for development, or if
 * GitHub is briefly unreachable) rather than requiring a Play Store listing.
 */

const RELEASE_OWNER = "kdaydin-sisal";
const RELEASE_REPO = "Http-tools";
const RELEASE_ASSET_NAME = "http-tools-companion.apk";
export const COMPANION_PACKAGE_ID = "com.httptools.companion";
export const COMPANION_MAIN_ACTIVITY = ".MainActivity";

const CACHE_DIR = path.join(os.homedir(), ".httptools", "companion-apk");
const CACHE_APK_PATH = path.join(CACHE_DIR, RELEASE_ASSET_NAME);
const CACHE_META_PATH = path.join(CACHE_DIR, "release.json");

// Locally-built APK, used only when no cached/remote APK is available (e.g.
// during development, before the first GitHub release is published, or if
// GitHub can't be reached and no prior download was cached).
const BUNDLED_APK_CANDIDATES = [
  path.join(process.cwd(), "android-companion", "app", "build", "outputs", "apk", "debug", "app-debug.apk"),
  path.join(process.cwd(), "android-companion", "app", "build", "outputs", "apk", "release", "app-release.apk"),
];

export interface CompanionApkInfo {
  apkPath: string;
  versionName: string;
  versionCode: number;
  packageId: string;
  source: "cache" | "remote" | "bundled";
}

interface CachedReleaseMeta {
  releaseTag: string;
  versionName: string;
  versionCode: number;
  packageId: string;
  downloadedAt: string;
}

interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  name: string | null;
  assets: GithubReleaseAsset[];
}

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

const readCachedMeta = async (): Promise<CachedReleaseMeta | undefined> => {
  try {
    const raw = await readFile(CACHE_META_PATH, "utf8");
    return JSON.parse(raw) as CachedReleaseMeta;
  } catch {
    return undefined;
  }
};

const fetchLatestRelease = async (): Promise<GithubRelease | undefined> => {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${RELEASE_OWNER}/${RELEASE_REPO}/releases/latest`,
      { headers: { accept: "application/vnd.github+json" } },
    );
    if (!response.ok) {
      // No releases published yet (404) or transient GitHub issue — callers
      // fall back to cache/bundled APK in either case.
      return undefined;
    }
    return (await response.json()) as GithubRelease;
  } catch {
    return undefined;
  }
};

/** Downloads a URL to a temp file, then parses it as an APK to confirm it's ours. */
const downloadAndInspectApk = async (
  url: string,
): Promise<{ tmpPath: string; versionName: string; versionCode: number; packageId: string }> => {
  await mkdir(CACHE_DIR, { recursive: true });
  // Must end in ".apk" -- app-info-parser infers the parser to use from the
  // file extension and rejects anything else (e.g. a ".download" suffix).
  const tmpPath = path.join(CACHE_DIR, `${RELEASE_ASSET_NAME}.download.apk`);

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download companion APK (HTTP ${response.status})`);
  }
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(tmpPath));

  const parsed = await parseApk(tmpPath);
  if (parsed.packageId !== COMPANION_PACKAGE_ID) {
    await unlink(tmpPath).catch(() => undefined);
    throw new Error(
      `Downloaded APK has unexpected package id "${parsed.packageId}" (expected "${COMPANION_PACKAGE_ID}")`,
    );
  }

  return { tmpPath, ...parsed };
};

const parseApk = async (
  apkPath: string,
): Promise<{ versionName: string; versionCode: number; packageId: string }> => {
  const parser = new AppInfoParser(apkPath);
  const result = await parser.parse();
  // app-info-parser collapses AndroidManifest.xml's root <manifest> attributes
  // directly onto the result (result.package, result.versionCode, ...).
  const versionCode = Number(result?.versionCode ?? NaN);
  const versionName = String(result?.versionName ?? "0.0.0");
  const packageId = String(result?.package ?? "");

  if (!Number.isFinite(versionCode)) {
    throw new Error(`Could not read versionCode from APK at ${apkPath}`);
  }
  if (!packageId) {
    throw new Error(`Could not read package id from APK at ${apkPath}`);
  }

  return { versionName, versionCode, packageId };
};

/**
 * Resolves the companion APK to use, preferring (in order): a fresh GitHub
 * release matching the cache, a valid cached download, or a locally-built
 * development APK. Throws only if none of these are available.
 */
export const resolveCompanionApk = async (): Promise<CompanionApkInfo> => {
  const release = await fetchLatestRelease();
  const asset = release?.assets.find((a) => a.name === RELEASE_ASSET_NAME);

  if (release && asset) {
    const cachedMeta = await readCachedMeta();
    const cacheIsCurrent =
      cachedMeta?.releaseTag === release.tag_name && (await fileExists(CACHE_APK_PATH));

    if (cacheIsCurrent && cachedMeta) {
      return {
        apkPath: CACHE_APK_PATH,
        versionName: cachedMeta.versionName,
        versionCode: cachedMeta.versionCode,
        packageId: cachedMeta.packageId,
        source: "cache",
      };
    }

    try {
      const { tmpPath, versionName, versionCode, packageId } = await downloadAndInspectApk(
        asset.browser_download_url,
      );
      await rename(tmpPath, CACHE_APK_PATH);
      const meta: CachedReleaseMeta = {
        releaseTag: release.tag_name,
        versionName,
        versionCode,
        packageId,
        downloadedAt: new Date().toISOString(),
      };
      await writeFile(CACHE_META_PATH, JSON.stringify(meta, null, 2), "utf8");
      return { apkPath: CACHE_APK_PATH, versionName, versionCode, packageId, source: "remote" };
    } catch (error) {
      // Fall through to cache/bundled below — a failed download shouldn't
      // block onboarding if we have something usable already.
      console.warn("[companion-release] Failed to download latest release, falling back:", error);
    }
  }

  // GitHub unreachable, no release published yet, or the download failed:
  // reuse a previously cached APK if we have one.
  const cachedMeta = await readCachedMeta();
  if (cachedMeta && (await fileExists(CACHE_APK_PATH))) {
    return {
      apkPath: CACHE_APK_PATH,
      versionName: cachedMeta.versionName,
      versionCode: cachedMeta.versionCode,
      packageId: cachedMeta.packageId,
      source: "cache",
    };
  }

  // Last resort: a locally-built development APK (not published anywhere).
  for (const candidate of BUNDLED_APK_CANDIDATES) {
    if (await fileExists(candidate)) {
      const parsed = await parseApk(candidate);
      return { apkPath: candidate, ...parsed, source: "bundled" };
    }
  }

  throw new Error(
    "Could not find a companion APK: no GitHub release is published yet, no cached download exists, " +
      "and no locally-built APK was found under android-companion/app/build/outputs/apk.",
  );
};
