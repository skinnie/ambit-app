import { BUILD_SHA } from '../config/version';

const RELEASES_URL = 'https://api.github.com/repos/guiguoz/opensportsync/releases/latest';

export interface UpdateInfo {
  available:   boolean;
  downloadUrl: string;
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  if (BUILD_SHA === 'dev') {
    return { available: false, downloadUrl: '' };
  }

  try {
    const res = await fetch(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    
    if (!res.ok) return { available: false, downloadUrl: '' };

    const release  = await res.json();
    const latestSha = release.target_commitish as string;
    const apkAsset  = release.assets?.find((a: any) => a.name.endsWith('.apk'));
    
    return {
      available:   latestSha !== BUILD_SHA,
      downloadUrl: apkAsset?.browser_download_url ?? release.html_url,
    };
  } catch (err: any) {
    return { available: false, downloadUrl: '' };
  }
}
