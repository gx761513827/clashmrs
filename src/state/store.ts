/** 设置与凭据的本地持久化。token 默认只放会话存储，勾选「记住」才落到 localStorage。 */
export interface Settings {
  owner: string;
  repo: string;
  branch: string;
  /** 规则集所在目录，允许为空（仓库根目录） */
  dir: string;
  /** 不含扩展名的文件名 */
  name: string;
  rememberToken: boolean;
}

export const SETTINGS_KEY = 'mrsgit.settings.v1';
export const TOKEN_KEY = 'mrsgit.token';

export const DEFAULT_SETTINGS: Settings = {
  owner: '',
  repo: '',
  branch: 'main',
  dir: 'rule',
  name: 'pt',
  rememberToken: false,
};

function readStorage(storage: Storage | undefined): string | null {
  try {
    return storage?.getItem(SETTINGS_KEY) ?? null;
  } catch {
    return null;
  }
}

export function loadSettings(): Settings {
  const raw = readStorage(typeof localStorage === 'undefined' ? undefined : localStorage);
  if (raw === null) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* 隐私模式下忽略 */
  }
}

/** 读取 token：勾选记住时读 localStorage，否则读 sessionStorage。 */
export function loadToken(remember: boolean): string {
  try {
    if (remember) return localStorage?.getItem(TOKEN_KEY) ?? '';
    return sessionStorage?.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveToken(token: string, remember: boolean): void {
  try {
    clearToken();
    if (token === '') return;
    if (remember) localStorage?.setItem(TOKEN_KEY, token);
    else sessionStorage?.setItem(TOKEN_KEY, token);
  } catch {
    /* 忽略 */
  }
}

export function clearToken(): void {
  try {
    localStorage?.removeItem(TOKEN_KEY);
    sessionStorage?.removeItem(TOKEN_KEY);
  } catch {
    /* 忽略 */
  }
}
