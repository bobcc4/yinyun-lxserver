export const ENV_PARAMS = [
  'PORT',
  'BIND_IP',
  'CONFIG_PATH',
  'LOG_PATH',
  'DATA_PATH',
  'PROXY_HEADER',
  'MAX_SNAPSHOT_NUM',
  'LIST_ADD_MUSIC_LOCATION_TYPE',
  'FRONTEND_PASSWORD',
  'ADMIN_PATH',
  'PUBLIC_URL',
  'WEBDAV_ENABLE',
  'WEBDAV_URL',
  'WEBDAV_USERNAME',
  'WEBDAV_PASSWORD',
  'WEBDAV_SYNC_PATH',
  'WEBDAV_BACKUP_PATH',
  'SYNC_INTERVAL',
  'BACKUP_INTERVAL',
  'DISABLE_TELEMETRY',
  'ENABLE_LOGIN_USER_CACHE_RESTRICTION',
  'ENABLE_CACHE_SIZE_LIMIT',
  'CACHE_SIZE_LIMIT',
  'PROXY_ALL_ENABLED',
  'PROXY_ALL_ADDRESS',
  'SUBSONIC_ENABLE',
  'SUBSONIC_PATH',
  'SINGER_SOURCE_PRIORITY',
  'SERVER_NAME',
  'LX_USER_',
] as const

export const SPLIT_CHAR = {
  DISLIKE_NAME: '@',
  DISLIKE_NAME_ALIAS: '#',
} as const

export const LIST_IDS = {
  DEFAULT: 'default',
  LOVE: 'love',
  TEMP: 'temp',
  DOWNLOAD: 'download',
  PLAY_LATER: null,
} as const

export const File = {
  serverInfoJSON: 'serverInfo.json',
  userDir: 'users',
  userSettingsJSON: 'settings.json',
  userPlaylistSharesJSON: 'playlistShares.json',
  userSoundEffectsJSON: 'soundEffects.json',
  userTokensJSON: 'token.json',
  userNetworkPlaylistCheckJSON: 'networkPlaylistCheck.json',
  listDir: 'list',
  listSnapshotDir: 'snapshot',
  listSnapshotInfoJSON: 'snapshotInfo.json',
  dislikeDir: 'dislike',
  dislikeSnapshotDir: 'snapshot',
  dislikeSnapshotInfoJSON: 'snapshotInfo.json',
} as const

export const FeaturesList = [
  'list',
  'dislike',
] as const
