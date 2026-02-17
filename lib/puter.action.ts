import puter from '@heyputer/puter.js';
import type { AuthUser } from '@heyputer/puter.js';
import { getOrCreateHostingConfig, uploadImageToHosting } from './puter.hosting';
import { isHostedUrl } from './utils';

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

/**
 * Tạo project mới với source và rendered images được host trên Puter
 *
 * MỤC ĐÍCH:
 * - Upload source và rendered images lên hosting subdomain
 * - Lưu project metadata vào KV store
 * - Trả về DesignItem với URLs đã được resolve
 *
 * FLOW:
 * 1. Lấy projectId từ item.id
 * 2. Get hoặc create hosting config (subdomain)
 * 3. Upload source image lên hosting (nếu có projectId)
 * 4. Upload rendered image lên hosting (nếu có projectId và renderedImage)
 * 5. Resolve URLs:
 *    - Source: Ưu tiên hosted URL → fallback về original nếu đã hosted → empty string
 *    - Rendered: Ưu tiên hosted URL → fallback về original nếu đã hosted → undefined
 * 6. Validate: Nếu không có resolvedSource → return null (project không hợp lệ)
 * 7. Tạo payload với resolved URLs
 * 8. Lưu project vào KV store
 * 9. Return DesignItem với URLs đã được resolve
 *
 * @param params - Object chứa:
 *   - item: DesignItem - Project data với sourceImage và renderedImage (optional)
 *   - visibility?: "private" | "public" - Visibility của project (chưa sử dụng trong logic hiện tại)
 *
 * @returns Promise<DesignItem | null>
 *   - DesignItem nếu thành công: với sourceImage và renderedImage đã được resolve thành hosted URLs
 *   - null nếu:
 *     - Không có resolvedSource (không thể host source image)
 *     - Lỗi khi save vào KV store
 *
 * @example
 * ```typescript
 * const project = await createProject({
 *   item: {
 *     id: "1234567890",
 *     sourceImage: "data:image/png;base64,...",
 *     renderedImage: "https://example.com/render.png",
 *     timestamp: Date.now(),
 *   }
 * });
 * // → DesignItem với sourceImage và renderedImage là hosted URLs
 * ```
 */
export const createProject = async ({
  item,
}: {
  item: DesignItem;
  visibility?: 'private' | 'public';
}): Promise<DesignItem | null | undefined> => {
  // BƯỚC 1: Lấy projectId từ item.id
  // projectId dùng để tổ chức files trong hosting: projects/{projectId}/
  const projectId = item.id;

  // BƯỚC 2: Get hoặc create hosting config
  // Đảm bảo có subdomain để host images
  // Nếu chưa có → tạo mới và lưu vào KV store
  // Nếu đã có → reuse subdomain cũ
  const hosting = await getOrCreateHostingConfig();

  // BƯỚC 3: Upload source image lên hosting
  // Chỉ upload nếu có projectId (để tổ chức files)
  // uploadImageToHosting() sẽ:
  // - Kiểm tra URL đã hosted chưa → nếu có thì return ngay
  // - Fetch image từ URL → convert thành blob
  // - Upload lên hosting subdomain: projects/{projectId}/source.{ext}
  // - Return hosted URL
  const hostedSource =
    projectId && item.sourceImage
      ? await uploadImageToHosting({
          hosting,
          url: item.sourceImage,
          projectId,
          label: 'source',
        })
      : null;

  // BƯỚC 4: Upload rendered image lên hosting (nếu có)
  // Chỉ upload nếu có cả projectId và renderedImage
  // uploadImageToHosting() với label: 'rendered' sẽ:
  // - Convert image sang PNG format (đảm bảo format nhất quán)
  // - Upload lên hosting: projects/{projectId}/rendered.png
  const hostedRender =
    projectId && item.renderedImage
      ? await uploadImageToHosting({
          hosting,
          url: item.renderedImage,
          projectId,
          label: 'rendered',
        })
      : null;

  // BƯỚC 5a: Resolve source image URL
  // Ưu tiên: hosted URL → original URL nếu đã hosted → empty string
  // hostedSource?.url: URL từ uploadImageToHosting() nếu upload thành công
  // isHostedUrl(item.sourceImage): Kiểm tra original URL đã là hosted URL chưa
  //   → Nếu đã hosted thì dùng luôn (không cần upload lại)
  //   → Nếu không thì dùng empty string (fallback)
  const resolvedSource =
    hostedSource?.url ||
    (isHostedUrl(item.sourceImage) ? item.sourceImage : '');

  // BƯỚC 5b: Resolve rendered image URL (nếu có)
  // Ưu tiên: hosted URL → original URL nếu đã hosted → undefined
  // hostedRender?.url: URL từ uploadImageToHosting() nếu upload thành công
  // isHostedUrl(item.renderedImage): Kiểm tra original URL đã là hosted URL chưa
  //   → Nếu đã hosted thì dùng luôn
  //   → Nếu không thì undefined (rendered image là optional)
  const resolvedRender =
    hostedRender?.url ||
    (item.renderedImage && isHostedUrl(item.renderedImage)
      ? item.renderedImage
      : undefined);

  // BƯỚC 6: Validate resolvedSource
  // Source image là bắt buộc → nếu không có resolvedSource thì project không hợp lệ
  // → Log warning và return null (không save project)
  if (!resolvedSource) {
    console.warn('Failed to host source image, skipping save.');
    return null;
  }

  // BƯỚC 7: Tạo payload với resolved URLs
  // Destructure item để loại bỏ các paths cũ (sourcePath, renderedPath, publicPath)
  // → Chỉ giữ lại các fields cần thiết
  // → Thay thế sourceImage và renderedImage bằng resolved URLs
  const { sourcePath: _sourcePath, renderedPath: _renderedPath, publicPath: _publicPath, ...rest } = item;

  const payload: DesignItem = {
    ...rest,
    sourceImage: resolvedSource,
    renderedImage: resolvedRender,
  };

  // BƯỚC 8: Lưu project vào KV store
  // Key: project:{projectId} để dễ query và organize
  // Value: payload (DesignItem với resolved URLs)
  try {
    // Call the Puter worker to store project in kv
    // Lưu project vào KV store với key format: "project:{projectId}"
    // → Dễ dàng query và list projects sau này
    await puter.kv.set(`project:${projectId}`, payload);

    // Return payload với resolved URLs
    return payload;
  } catch (e) {
    // XỬ LÝ LỖI:
    // Các trường hợp có thể xảy ra lỗi:
    // - KV store không accessible
    // - Network error
    // - Permission denied
    // → Log error để debug và return null
    console.error('Failed to save project', e);
    return null;
  }
};
