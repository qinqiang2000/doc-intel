const TOKEN_KEY = "doc-intel.token";
const WS_KEY = "doc-intel.currentWorkspaceId";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(WS_KEY);
}

export function getCurrentWorkspaceId(): string | null {
  return localStorage.getItem(WS_KEY);
}

export function setCurrentWorkspaceId(id: string | null): void {
  if (id === null) {
    localStorage.removeItem(WS_KEY);
  } else {
    localStorage.setItem(WS_KEY, id);
  }
}
