import puter from "@heyputer/puter.js";
import type { AuthUser } from "@heyputer/puter.js";

export type SignInOptions = {
  attempt_temp_user_creation?: boolean;
};

export interface SignInResult {
  success: boolean;
  token: string;
  app_uid: string;
  username: string;
  error?: string;
  msg?: string;
}

/**
 * Mở popup đăng nhập Puter. Phải gọi từ user action (vd: onClick) vì trình duyệt chặn popup không từ click.
 */
export const signIn = async (
  options?: SignInOptions
): Promise<SignInResult> => {
  return puter.auth.signIn(options) as Promise<SignInResult>;
};

/**
 * Đăng xuất khỏi Puter.
 */
export const signOut = (): void => {
  puter.auth.signOut();
};

/**
 * Kiểm tra user đã đăng nhập chưa.
 */
export const isSignedIn = (): boolean => {
  return puter.auth.isSignedIn();
};

/**
 * Lấy thông tin user hiện tại (sau khi đã sign in).
 */
export const getUser = async (): Promise<AuthUser | null> => {
  if (!puter.auth.isSignedIn()) return null;
  return puter.auth.getUser();
};
