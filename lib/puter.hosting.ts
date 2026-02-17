import puter from '@heyputer/puter.js';
import { STORAGE_PATHS } from './constants';
import {
  HOSTING_CONFIG_KEY,
  createHostingSlug,
  isHostedUrl,
  getHostedUrl,
  getImageExtension,
  fetchBlobFromUrl,
  imageUrlToPngBlob,
} from './utils';

type HostingConfig = { subdomain: string };
type HostedAsset = { url: string };

/**
 * Đảm bảo directory tồn tại, nếu chưa có thì tạo mới
 *
 * MỤC ĐÍCH:
 * - Tạo directory structure trước khi upload file
 * - Tránh lỗi khi upload vào path không tồn tại
 * - Tự động tạo parent directories nếu cần
 *
 * CÁCH HOẠT ĐỘNG:
 * - Gọi puter.fs.mkdir() với option createMissingParents: true
 * - Nếu directory đã tồn tại → bỏ qua (không throw error)
 * - Nếu có lỗi khác → log warning nhưng không throw (graceful failure)
 *
 * @param dirPath - Path của directory cần tạo (ví dụ: "roomify/sources/project-123")
 */
const ensureDirectoryExists = async (dirPath: string): Promise<void> => {
  try {
    // Tạo directory với option createMissingParents: true
    // → Tự động tạo tất cả parent directories nếu chưa có
    // Ví dụ: "roomify/sources/project-123"
    //   → Tạo "roomify" nếu chưa có
    //   → Tạo "roomify/sources" nếu chưa có
    //   → Tạo "roomify/sources/project-123"
    await puter.fs.mkdir(dirPath, { createMissingParents: true });
  } catch (error) {
    // Nếu directory đã tồn tại → không sao, bỏ qua
    // Nếu có lỗi khác → log warning nhưng không throw
    // → Cho phép code tiếp tục chạy (graceful failure)
    // → Upload có thể vẫn thành công nếu directory đã tồn tại
    console.warn(`Directory ${dirPath} may already exist or error:`, error);
  }
};

/**
 * Convert base64 string thành Blob object
 *
 * MỤC ĐÍCH:
 * - Chuyển đổi base64 string (từ FileReader.readAsDataURL) thành Blob
 * - Blob cần thiết để tạo File object và upload lên Puter
 *
 * CÁCH HOẠT ĐỘNG:
 * 1. Loại bỏ data URL prefix nếu có (ví dụ: "data:image/png;base64,")
 * 2. Decode base64 string thành binary data
 * 3. Convert binary data thành Uint8Array
 * 4. Tạo Blob từ Uint8Array với mime type tương ứng
 *
 * @param base64 - Base64 string (có thể có hoặc không có data URL prefix)
 * @param mimeType - MIME type của file (mặc định: 'image/png')
 * @returns Blob object có thể dùng để tạo File
 *
 * @example
 * ```typescript
 * const base64 = "data:image/png;base64,iVBORw0KG...";
 * const blob = base64ToBlob(base64, 'image/png');
 * const file = new File([blob], 'image.png', { type: 'image/png' });
 * ```
 */
const base64ToBlob = (base64: string, mimeType: string = 'image/png'): Blob => {
  // BƯỚC 1: Loại bỏ data URL prefix nếu có
  // Base64 từ FileReader.readAsDataURL() có format: "data:image/png;base64,{base64Data}"
  // → Chỉ cần phần base64 data sau dấu phẩy
  // Nếu không có prefix → dùng nguyên base64 string
  const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;

  // BƯỚC 2: Decode base64 string thành binary string
  // atob() = ASCII to Binary: decode base64 → binary string
  // Ví dụ: "iVBORw0KG..." → "\x89PNG\r\n\x1a\n..."
  const byteCharacters = atob(base64Data);

  // BƯỚC 3: Convert binary string thành array of byte numbers
  // Tạo array với length = số ký tự trong binary string
  // Mỗi ký tự → số (charCodeAt) → lưu vào array
  const byteNumbers = new Array(byteCharacters.length);

  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }

  // BƯỚC 4: Convert array of numbers thành Uint8Array (typed array)
  // Uint8Array = array of unsigned 8-bit integers (0-255)
  // → Format phù hợp để tạo Blob
  const byteArray = new Uint8Array(byteNumbers);

  // BƯỚC 5: Tạo Blob từ Uint8Array với mime type
  // Blob = Binary Large Object, đại diện cho binary data
  // → Có thể dùng để tạo File object hoặc upload trực tiếp
  return new Blob([byteArray], { type: mimeType });
};

/**
 * Upload hình ảnh từ base64 string lên Puter storage
 *
 * MỤC ĐÍCH:
 * - Upload image từ base64 string (thường từ FileReader hoặc canvas.toDataURL)
 * - Lưu vào thư mục sources trong Puter cloud storage
 * - Trả về path của file để có thể truy cập sau này
 *
 * FLOW:
 * 1. Kiểm tra user đã đăng nhập
 * 2. Detect mime type từ base64 hoặc filename
 * 3. Convert base64 → Blob → File object
 * 4. Xác định target directory (sources hoặc sources/subdirectory)
 * 5. Đảm bảo directory tồn tại
 * 6. Upload file lên Puter storage
 * 7. Return file path
 *
 * @param base64 - Base64 string của hình ảnh
 *   - Có thể có prefix: "data:image/png;base64,iVBORw0KG..."
 *   - Hoặc không có: "iVBORw0KG..."
 * @param filename - Tên file khi lưu (ví dụ: "floor-plan.png", "source-123.png")
 * @param subdirectory - Subdirectory trong sources (tùy chọn)
 *   - Ví dụ: "project-123" → lưu vào "roomify/sources/project-123/"
 *   - Nếu không có → lưu vào "roomify/sources/"
 * @returns Promise<string> - Path của file đã upload
 *   - Ví dụ: "roomify/sources/project-123/floor-plan.png"
 *
 * @throws Error nếu user chưa đăng nhập
 *
 * @example
 * ```typescript
 * const base64 = "data:image/png;base64,iVBORw0KG...";
 * const path = await uploadImageFromBase64(base64, "floor-plan.png", "project-123");
 * // → "roomify/sources/project-123/floor-plan.png"
 * ```
 */
export const uploadImageFromBase64 = async (
  base64: string,
  filename: string,
  subdirectory?: string
): Promise<string> => {
  // BƯỚC 1: Kiểm tra authentication
  // Puter storage yêu cầu user phải đăng nhập
  if (!puter.auth.isSignedIn()) {
    throw new Error('User must be signed in to upload files');
  }

  // BƯỚC 2: Xác định MIME type của image
  // MIME type cần thiết để browser hiểu đúng loại file
  // Ưu tiên: base64 prefix > filename extension > default (png)
  let mimeType = 'image/png'; // Default fallback

  // Nếu base64 có prefix "data:image/png;base64," → extract mime type từ đó
  if (base64.startsWith('data:')) {
    const mimeMatch = base64.match(/data:([^;]+);/);
    if (mimeMatch) {
      mimeType = mimeMatch[1]; // Ví dụ: "image/png", "image/jpeg"
    }
  }
  // Nếu không có prefix → dựa vào file extension
  else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
    mimeType = 'image/jpeg';
  } else if (filename.endsWith('.png')) {
    mimeType = 'image/png';
  }

  // BƯỚC 3: Convert base64 → Blob → File object
  // File object cần thiết để upload lên Puter
  const blob = base64ToBlob(base64, mimeType);
  const file = new File([blob], filename, { type: mimeType });

  // BƯỚC 4: Xác định target directory
  // Nếu có subdirectory → lưu vào "sources/subdirectory/"
  // Nếu không → lưu vào "sources/"
  const targetDir = subdirectory
    ? `${STORAGE_PATHS.SOURCES}/${subdirectory}`
    : STORAGE_PATHS.SOURCES;
  // Ví dụ: "roomify/sources/project-123" hoặc "roomify/sources"

  // BƯỚC 5: Đảm bảo directory tồn tại trước khi upload
  // Tự động tạo directory structure nếu chưa có
  await ensureDirectoryExists(targetDir);

  // BƯỚC 6: Upload file lên Puter cloud storage
  // puter.fs.upload() sẽ:
  // - Upload file lên Puter infrastructure
  // - Trả về FSItem object với thông tin file (path, name, size, etc.)
  // Options:
  //   - createMissingParents: true → tự động tạo parent directories
  //   - overwrite: true → ghi đè file nếu đã tồn tại
  const uploadedFile = await puter.fs.upload([file], targetDir, {
    createMissingParents: true,
    overwrite: true,
  });

  // BƯỚC 7: Xử lý response và return path
  // puter.fs.upload() có thể trả về:
  // - Array nếu upload nhiều files: [FSItem1, FSItem2, ...]
  // - Single FSItem nếu upload 1 file: FSItem
  // → Cần normalize về single FSItem
  const fileItem = Array.isArray(uploadedFile) ? uploadedFile[0] : uploadedFile;

  // Return path của file để có thể truy cập sau này
  // Ví dụ: "roomify/sources/project-123/floor-plan.png"
  return fileItem.path;
};

/**
 * Upload hình ảnh từ File object lên Puter storage
 * @param file - File object từ input hoặc drag-and-drop
 * @param subdirectory - Subdirectory trong STORAGE_PATHS.SOURCES (ví dụ: "project-123")
 * @returns Promise<string> - Path của file đã upload
 */
export const uploadImageFromFile = async (
  file: File,
  subdirectory?: string
): Promise<string> => {
  if (!puter.auth.isSignedIn()) {
    throw new Error('User must be signed in to upload files');
  }

  // Xác định target directory
  const targetDir = subdirectory
    ? `${STORAGE_PATHS.SOURCES}/${subdirectory}`
    : STORAGE_PATHS.SOURCES;

  // Đảm bảo directory tồn tại
  await ensureDirectoryExists(targetDir);

  // Upload file
  const uploadedFile = await puter.fs.upload([file], targetDir, {
    createMissingParents: true,
    overwrite: true,
  });

  // puter.fs.upload trả về array nếu upload nhiều files, hoặc single FSItem nếu 1 file
  const fileItem = Array.isArray(uploadedFile) ? uploadedFile[0] : uploadedFile;

  return fileItem.path;
};

/**
 * Upload rendered image lên Puter storage (vào thư mục renders)
 * @param base64 - Base64 string của hình ảnh đã render
 * @param filename - Tên file (ví dụ: "render-123.png")
 * @param subdirectory - Subdirectory trong STORAGE_PATHS.RENDERS (ví dụ: "project-123")
 * @returns Promise<string> - Path của file đã upload
 */
export const uploadRenderedImage = async (
  base64: string,
  filename: string,
  subdirectory?: string
): Promise<string> => {
  if (!puter.auth.isSignedIn()) {
    throw new Error('User must be signed in to upload files');
  }

  // Xác định mime type từ base64 hoặc filename
  let mimeType = 'image/png';
  if (base64.startsWith('data:')) {
    const mimeMatch = base64.match(/data:([^;]+);/);
    if (mimeMatch) {
      mimeType = mimeMatch[1];
    }
  } else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
    mimeType = 'image/jpeg';
  } else if (filename.endsWith('.png')) {
    mimeType = 'image/png';
  }

  // Tạo Blob từ base64
  const blob = base64ToBlob(base64, mimeType);
  const file = new File([blob], filename, { type: mimeType });

  // Xác định target directory
  const targetDir = subdirectory
    ? `${STORAGE_PATHS.RENDERS}/${subdirectory}`
    : STORAGE_PATHS.RENDERS;

  // Đảm bảo directory tồn tại
  await ensureDirectoryExists(targetDir);

  // Upload file
  const uploadedFile = await puter.fs.upload([file], targetDir, {
    createMissingParents: true,
    overwrite: true,
  });

  // puter.fs.upload trả về array nếu upload nhiều files, hoặc single FSItem nếu 1 file
  const fileItem = Array.isArray(uploadedFile) ? uploadedFile[0] : uploadedFile;

  return fileItem.path;
};

/**
 * Lấy hoặc tạo hosting config từ KV store
 *
 * MỤC ĐÍCH:
 * - Đảm bảo mỗi user có một subdomain hosting để host images
 * - Tái sử dụng subdomain đã tạo thay vì tạo mới mỗi lần upload
 * - Lưu config vào KV store để persistent (không mất khi refresh)
 *
 * CÁCH HOẠT ĐỘNG:
 * 1. Kiểm tra user đã đăng nhập chưa (bắt buộc để dùng KV store và hosting)
 * 2. Thử lấy config từ KV store với key 'roomify_hosting_config'
 * 3. Nếu đã có config → return ngay (reuse subdomain cũ)
 * 4. Nếu chưa có → tạo subdomain mới → lưu vào KV store → return
 *
 * LỢI ÍCH:
 * - Performance: Không cần tạo subdomain mới mỗi lần upload
 * - Cost: Tiết kiệm tài nguyên (ít subdomain hơn)
 * - Consistency: Tất cả images của user trên cùng subdomain
 *
 * @returns Promise<HostingConfig | null>
 *   - HostingConfig nếu thành công: { subdomain: 'roomify-abc123-def456' }
 *   - null nếu user chưa đăng nhập hoặc có lỗi
 *
 * @example
 * ```typescript
 * const config = await getOrCreateHostingConfig();
 * if (config) {
 *   // Sử dụng config.subdomain để host files
 *   const url = `https://${config.subdomain}.puter.site/image.png`;
 * }
 * ```
 */
export const getOrCreateHostingConfig = async (): Promise<HostingConfig | null> => {
  // BƯỚC 1: Kiểm tra authentication
  // KV store và hosting API yêu cầu user phải đăng nhập
  // Nếu chưa đăng nhập → return null ngay (không thể tạo hosting)
  if (!puter.auth.isSignedIn()) {
    return null;
  }

  try {
    // BƯỚC 2: Thử lấy config từ KV store
    // KV store là database key-value của Puter, lưu trữ persistent trên cloud
    // Mỗi user có KV store riêng (tự động theo authentication)
    // Key: 'roomify_hosting_config' (định nghĩa trong utils.ts)
    const existing = await puter.kv.get(HOSTING_CONFIG_KEY);

    // BƯỚC 3a: Nếu đã có config trong KV store → verify và return
    // Điều này có nghĩa là user đã từng upload trước đó và đã có subdomain
    // → Reuse subdomain cũ thay vì tạo mới (tối ưu performance và cost)
    if (existing) {
      const config = existing as HostingConfig;
      const hostingRootDir = 'roomify-hosting';
      
      // Verify hosting subdomain có tồn tại không
      // Nếu subdomain đã tồn tại → đảm bảo nó point đến directory đúng
      try {
        await puter.hosting.get(config.subdomain);
        
        // Subdomain tồn tại → đảm bảo directory tồn tại và update hosting
        // Đảm bảo directory tồn tại
        await puter.fs.mkdir(hostingRootDir, { createMissingParents: true });
        // Update hosting để point đến directory (idempotent - safe to call multiple times)
        await puter.hosting.update(config.subdomain, hostingRootDir);
        
        // Config hợp lệ → return
        return config;
      } catch (err) {
        // Nếu không get được hosting info → có thể subdomain không tồn tại
        // → Tạo lại hosting subdomain
        console.warn('Hosting subdomain may not exist, will create new one:', err);
        // Fall through để tạo mới bên dưới
      }
    }

    // BƯỚC 3b: Nếu chưa có config → tạo subdomain mới
    // Đây là lần đầu tiên user upload, chưa có subdomain nào

    // Tạo slug unique cho subdomain
    // Ví dụ: "roomify-lx123abc-def456"
    // - "roomify-" là prefix
    // - "lx123abc" là timestamp dạng base36 (ngắn gọn hơn số thập phân)
    // - "def456" là random string để tránh collision
    const subdomain = createHostingSlug();

    // BƯỚC 3c: Tạo root directory cho hosting
    // Hosting subdomain cần point đến một directory cụ thể
    // Tạo directory "roomify-hosting" để chứa tất cả files
    const hostingRootDir = 'roomify-hosting';
    await puter.fs.mkdir(hostingRootDir, { createMissingParents: true });

    // Tạo hosting subdomain trên Puter và point đến directory
    // puter.hosting.create() sẽ:
    // - Tạo subdomain mới trên Puter infrastructure
    // - Point subdomain đến directory được chỉ định
    // - Trả về Subdomain object với thông tin subdomain, uid, etc.
    // - Subdomain sẽ có format: {subdomain}.puter.site
    // - Files trong hostingRootDir sẽ accessible qua subdomain
    const site = await puter.hosting.create(subdomain, hostingRootDir);

    // BƯỚC 4: Lưu config vào KV store để dùng lại lần sau
    // Tạo config object chỉ chứa subdomain (thông tin cần thiết)
    const config: HostingConfig = { subdomain: site.subdomain };

    // Lưu vào KV store với key 'roomify_hosting_config'
    // Lần sau gọi hàm này sẽ lấy được config này thay vì tạo mới
    await puter.kv.set(HOSTING_CONFIG_KEY, config);

    // BƯỚC 5: Return config để caller sử dụng
    return config;
  } catch (error) {
    // XỬ LÝ LỖI:
    // Các trường hợp có thể xảy ra lỗi:
    // - Subdomain đã tồn tại (collision - rất hiếm vì có random string)
    // - KV store không accessible
    // - Network error
    // - Permission denied
    // → Log error để debug và return null để caller biết có lỗi
    console.error('Error getting or creating hosting config:', error);
    return null;
  }
};

/**
 * Upload hình ảnh lên Puter hosting subdomain và trả về hosted URL
 *
 * MỤC ĐÍCH:
 * - Upload image từ URL (có thể là data URL, external URL, hoặc đã hosted) lên hosting subdomain
 * - Tổ chức files theo project structure: projects/{projectId}/{label}.{ext}
 * - Trả về public URL để có thể share và access từ browser
 *
 * FLOW:
 * 1. Validate input (hosting config và URL)
 * 2. Kiểm tra URL đã được host chưa → nếu có thì return ngay
 * 3. Resolve image thành blob:
 *    - Nếu label === "rendered" → convert sang PNG blob (đảm bảo format)
 *    - Ngược lại → fetch blob từ URL (giữ nguyên format)
 * 4. Xác định file extension từ contentType hoặc URL
 * 5. Tạo directory structure: projects/{projectId}/
 * 6. Upload file lên hosting với tên: {label}.{ext}
 * 7. Generate và return hosted URL
 *
 * @param params - Object chứa các tham số:
 *   - hosting: HostingConfig | null - Config subdomain để host file
 *     - Nếu null → không thể upload, return null
 *   - url: string - URL của image cần upload
 *     - Có thể là: data URL, external URL, hoặc đã hosted URL
 *   - projectId: string - ID của project để tổ chức files
 *     - Ví dụ: "1234567890" → lưu vào "projects/1234567890/"
 *   - label: "source" | "rendered" - Label để đặt tên file
 *     - "source" → file gốc từ user upload
 *     - "rendered" → file đã được render/process
 *     - File sẽ có tên: "source.png" hoặc "rendered.png"
 *
 * @returns Promise<HostedAsset | null>
 *   - HostedAsset nếu thành công: { url: "https://roomify-abc123.puter.site/projects/123/source.png" }
 *   - null nếu:
 *     - hosting config không có
 *     - URL không hợp lệ hoặc không fetch được
 *     - Upload thất bại
 *
 * @example
 * ```typescript
 * const hosting = await getOrCreateHostingConfig();
 * const result = await uploadImageToHosting({
 *   hosting,
 *   url: "https://example.com/image.jpg",
 *   projectId: "1234567890",
 *   label: "source"
 * });
 * // → { url: "https://roomify-abc123.puter.site/projects/1234567890/source.jpg" }
 * ```
 */
export const uploadImageToHosting = async ({
  hosting,
  url,
  projectId,
  label,
}: {
  hosting: HostingConfig | null;
  url: string;
  projectId: string;
  label: 'source' | 'rendered';
}): Promise<HostedAsset | null> => {
  // BƯỚC 1: Validate input
  // Nếu không có hosting config hoặc URL → không thể upload
  // → Return null ngay (early exit)
  if (!hosting || !url) {
    return null;
  }

  // BƯỚC 2: Kiểm tra URL đã được host trên Puter chưa
  // Nếu URL đã chứa ".puter.site" → đã được host rồi
  // → Không cần upload lại, return URL hiện tại
  // → Tiết kiệm bandwidth và storage
  if (isHostedUrl(url)) {
    return { url };
  }

  try {
    // BƯỚC 3: Resolve image thành blob
    // Có 2 cách tùy thuộc vào label:

    let resolved: { blob: Blob; contentType: string } | null = null;

    if (label === 'rendered') {
      // Nếu là rendered image → convert sang PNG blob
      // Lý do: Đảm bảo format nhất quán cho rendered images
      // imageUrlToPngBlob() sẽ:
      // - Load image vào canvas
      // - Convert sang PNG format
      // - Return PNG blob
      const pngBlob = await imageUrlToPngBlob(url);
      if (pngBlob) {
        resolved = { blob: pngBlob, contentType: 'image/png' };
      }
    } else {
      // Nếu là source image → fetch blob từ URL (giữ nguyên format)
      // fetchBlobFromUrl() sẽ:
      // - Nếu là data URL → parse thành blob
      // - Nếu là external URL → fetch từ network
      // - Return blob với contentType từ response headers
      resolved = await fetchBlobFromUrl(url);
    }

    // Nếu không resolve được blob → return null
    // Có thể do: URL không hợp lệ, network error, CORS issue, etc.
    if (!resolved) {
      return null;
    }

    // BƯỚC 4: Xác định file extension
    // getImageExtension() sẽ:
    // - Ưu tiên: contentType từ blob
    // - Fallback: extension từ URL
    // - Default: "png"
    // Ví dụ: "image/jpeg" → "jpg", "image/png" → "png"
    const contentType =
      resolved.contentType || resolved.blob.type || '';
    const ext = getImageExtension(contentType, url);

    // BƯỚC 5: Xây dựng directory và file path
    // Hosting root directory: "roomify-hosting"
    // Directory: "roomify-hosting/projects/{projectId}/"
    // File path: "roomify-hosting/projects/{projectId}/{label}.{ext}"
    // Ví dụ:
    //   - projectId: "1234567890"
    //   - label: "source"
    //   - ext: "jpg"
    //   → "roomify-hosting/projects/1234567890/source.jpg"
    const hostingRootDir = 'roomify-hosting';
    const dir = `${hostingRootDir}/projects/${projectId}`;
    const filePath = `${dir}/${label}.${ext}`;

    // BƯỚC 6: Tạo File object từ blob
    // File object cần thiết để upload lên Puter hosting
    // Tên file: "{label}.{ext}" (ví dụ: "source.jpg", "rendered.png")
    const uploadFile = new File([resolved.blob], `${label}.${ext}`, {
      type: contentType,
    });

    // BƯỚC 7: Tạo directory structure trên hosting
    // puter.fs.mkdir() với createMissingParents: true
    // → Tự động tạo "projects/" và "projects/{projectId}/" nếu chưa có
    await puter.fs.mkdir(dir, { createMissingParents: true });

    // BƯỚC 8: Upload file lên hosting subdomain
    // puter.fs.write() sẽ:
    // - Write file vào hosting file system
    // - File sẽ được serve qua subdomain: https://{subdomain}.puter.site/{filePath}
    await puter.fs.write(filePath, uploadFile);

    // BƯỚC 9: Generate hosted URL và return
    // getHostedUrl() sẽ tạo URL đầy đủ:
    // https://{subdomain}.puter.site/{filePath}
    // Ví dụ: "https://roomify-abc123.puter.site/projects/1234567890/source.jpg"
    const hostedUrl = getHostedUrl(hosting, filePath);

    // Nếu không generate được URL → return null
    if (!hostedUrl) {
      console.error('Failed to generate hosted URL for:', filePath);
      return null;
    }

    // Return HostedAsset với URL để caller sử dụng
    return { url: hostedUrl };
  } catch (error) {
    // XỬ LÝ LỖI:
    // Các trường hợp có thể xảy ra lỗi:
    // - Network error khi fetch image
    // - CORS issue với external URL
    // - Directory creation failed
    // - File write failed
    // - URL generation failed
    // → Log error để debug và return null
    console.error('Error uploading image to hosting:', error);
    return null;
  }
};
