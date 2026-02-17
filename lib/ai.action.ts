import puter from '@heyputer/puter.js';
import { ROOMIFY_RENDER_PROMPT, IMAGE_3D_RENDER_DIMENSION } from './constants';

/**
 * Convert image URL thành Data URL string
 *
 * MỤC ĐÍCH:
 * - Fetch image từ URL và convert thành base64 data URL
 * - Sử dụng để prepare image data cho AI processing (generate 3D, etc.)
 * - Return Promise<string> với format: "data:image/{type};base64,{base64Data}"
 *
 * FLOW:
 * 1. Fetch image từ URL
 * 2. Validate response (throw error nếu fail)
 * 3. Convert response thành Blob
 * 4. Dùng FileReader để đọc Blob thành Data URL
 * 5. Return Promise với Data URL string
 *
 * @param url - URL của image cần convert
 *   - Có thể là: hosted URL, external URL, hoặc data URL (return ngay)
 * @returns Promise<string> - Data URL string
 *   - Format: "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
 *   - Reject với error nếu fetch hoặc conversion fail
 *
 * @example
 * ```typescript
 * const dataUrl = await fetchAsDataUrl('https://example.com/image.jpg');
 * // → "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
 * ```
 */
export const fetchAsDataUrl = async (url: string): Promise<string> => {
  // BƯỚC 1: Nếu URL đã là data URL → return ngay (không cần fetch)
  // Kiểm tra format: "data:image/..."
  if (url.startsWith('data:')) {
    return url;
  }

  // BƯỚC 2: Fetch image từ URL
  // fetch() sẽ:
  // - Gửi HTTP request đến URL
  // - Trả về Response object
  // - Throw error nếu network fail hoặc URL không hợp lệ
  const response = await fetch(url);

  // BƯỚC 3: Validate response
  // Nếu response không OK (status không phải 2xx) → throw error
  // Điều này đảm bảo chỉ process images hợp lệ
  if (!response.ok) {
    throw new Error(
      `Failed to fetch image: ${response.status} ${response.statusText}`
    );
  }

  // BƯỚC 4: Convert response thành Blob
  // response.blob() sẽ:
  // - Đọc response body thành binary data
  // - Tạo Blob object với content type từ response headers
  // - Return Promise<Blob>
  const blob = await response.blob();

  // BƯỚC 5: Convert Blob thành Data URL bằng FileReader
  // FileReader.readAsDataURL() sẽ:
  // - Đọc Blob và convert thành base64 string
  // - Format: "data:{mimeType};base64,{base64Data}"
  // - Trigger 'load' event khi complete
  // - Trigger 'error' event nếu fail
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    // Success handler: resolve với Data URL string
    reader.onload = () => {
      // reader.result là string chứa Data URL
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert blob to data URL'));
      }
    };

    // Error handler: reject với error
    reader.onerror = () => {
      reject(new Error('FileReader failed to read blob'));
    };

    // Bắt đầu đọc Blob thành Data URL
    reader.readAsDataURL(blob);
  });
};

/**
 * Extract base64 data từ Data URL string
 *
 * MỤC ĐÍCH:
 * - Extract phần base64 data từ Data URL (loại bỏ prefix "data:image/...;base64,")
 * - Cần thiết cho Puter AI API vì nó yêu cầu base64 string thuần, không có prefix
 *
 * @param dataUrl - Data URL string với format: "data:image/jpeg;base64,{base64Data}"
 * @returns string - Base64 string thuần (không có prefix)
 *
 * @example
 * ```typescript
 * const base64 = extractBase64FromDataUrl('data:image/jpeg;base64,/9j/4AAQ...');
 * // → "/9j/4AAQ..."
 * ```
 */
const extractBase64FromDataUrl = (dataUrl: string): string => {
  // Data URL format: "data:image/{type};base64,{base64Data}"
  // → Cần extract phần sau dấu phẩy
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) {
    throw new Error('Invalid data URL format');
  }
  return dataUrl.substring(commaIndex + 1);
};

/**
 * Determine MIME type từ Data URL hoặc URL
 *
 * @param url - Data URL hoặc regular URL
 * @returns string - MIME type (ví dụ: "image/png", "image/jpeg")
 */
const getMimeTypeFromUrl = (url: string): string => {
  if (url.startsWith('data:')) {
    // Extract từ data URL: "data:image/png;base64,..."
    const match = url.match(/data:([^;]+)/);
    return match ? match[1] : 'image/png';
  }
  
  // Extract từ file extension
  if (url.endsWith('.jpg') || url.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (url.endsWith('.png')) {
    return 'image/png';
  }
  if (url.endsWith('.webp')) {
    return 'image/webp';
  }
  
  // Default
  return 'image/png';
};

/**
 * Cấu hình các model dùng cho 3D generation (theo thứ tự ưu tiên).
 * Model đầu tiên được thử trước; nếu lỗi thì thử lần lượt model tiếp theo.
 */
const THREE_D_MODEL_CONFIGS = [
  {
    provider: 'gemini' as const,
    model: 'gemini-2.5-flash-image-preview',
    useInputImage: true, // image-to-image
    ratio: { w: IMAGE_3D_RENDER_DIMENSION, h: IMAGE_3D_RENDER_DIMENSION },
  },
  {
    provider: 'gemini' as const,
    model: 'gemini-3-pro-image-preview',
    useInputImage: true,
    ratio: { w: IMAGE_3D_RENDER_DIMENSION, h: IMAGE_3D_RENDER_DIMENSION },
  },
  {
    provider: 'xai' as const,
    model: 'grok-2-image',
    useInputImage: false, // Grok chỉ hỗ trợ text-to-image
  },
] as const;

/**
 * Generate 3D view từ floor plan image sử dụng Puter AI
 *
 * MỤC ĐÍCH:
 * - Convert 2D floor plan image thành 3D visualization
 * - Sử dụng Puter AI txt2img với image-to-image generation
 * - Return HTMLImageElement với 3D rendered image
 *
 * FLOW:
 * 1. Convert image URL thành Data URL bằng fetchAsDataUrl()
 * 2. Extract base64 data từ Data URL
 * 3. Determine MIME type từ URL
 * 4. Gọi puter.ai.txt2img() lần lượt với danh sách model (fallback):
 *    - Ưu tiên: Gemini (image-to-image) → Gemini 3 → Grok (xAI, text-to-image).
 *    - Nếu model hiện tại lỗi thì thử model tiếp theo.
 * 5. Return HTMLImageElement với 3D rendered image (từ model đầu tiên thành công)
 *
 * @param imageUrl - URL của floor plan image cần convert
 *   - Có thể là: hosted URL, external URL, hoặc data URL
 * @param options - Optional configuration
 *   - prompt: Custom prompt cho AI generation (default: 3D floor plan prompt)
 *   - model: AI model to use (default: 'gemini-2.5-flash-image-preview')
 *   - testMode: Use test API without consuming credits (default: false)
 * @returns Promise<HTMLImageElement> - Image element với 3D rendered image
 *   - Image element có src pointing đến data URL của 3D image
 *   - Reject với error nếu generation fail
 *
 * @example
 * ```typescript
 * const image3D = await generate3DView('https://roomify-abc.puter.site/projects/123/source.jpg');
 * document.body.appendChild(image3D);
 * ```
 *
 * @example
 * ```typescript
 * const image3D = await generate3DView(imageUrl, {
 *   prompt: 'Convert this floor plan into a realistic 3D interior visualization',
 *   testMode: true
 * });
 * ```
 */
export const generate3DView = async (
  imageUrl: string,
  options?: {
    prompt?: string;
    model?: string;
    testMode?: boolean;
  }
): Promise<HTMLImageElement> => {
  // BƯỚC 1: Convert image URL thành Data URL
  // fetchAsDataUrl() sẽ:
  // - Fetch image từ URL nếu cần
  // - Convert thành base64 data URL
  // - Return data URL string
  const dataUrl = await fetchAsDataUrl(imageUrl);

  // BƯỚC 2: Extract base64 data từ Data URL
  // Puter AI API yêu cầu base64 string thuần (không có "data:image/...;base64," prefix)
  const base64Data = extractBase64FromDataUrl(dataUrl);

  // BƯỚC 3: Determine MIME type
  // Cần thiết cho Puter AI API để biết format của input image
  const mimeType = getMimeTypeFromUrl(imageUrl);

  // BƯỚC 4: Prepare prompt cho AI generation
  const prompt = options?.prompt || ROOMIFY_RENDER_PROMPT;

  // BƯỚC 5 & 6: Thử lần lượt các model (primary → fallback). Khi một model lỗi thì thử model tiếp theo.
  let lastError: Error | null = null;
  const testMode = options?.testMode ?? false;
  const primaryModelOverride = options?.model; // Nếu có thì dùng cho config đầu tiên

  for (let i = 0; i < THREE_D_MODEL_CONFIGS.length; i++) {
    const config = THREE_D_MODEL_CONFIGS[i];
    const model = i === 0 && primaryModelOverride ? primaryModelOverride : config.model;

    const aiOptions: Record<string, unknown> = {
      provider: config.provider,
      model,
      prompt,
      test_mode: testMode,
    };

    if (config.useInputImage) {
      aiOptions.input_image = base64Data;
      aiOptions.input_image_mime_type = mimeType;
    }
    if ('ratio' in config && config.ratio) {
      aiOptions.ratio = config.ratio;
    }

    try {
      const image3D = await puter.ai.txt2img(aiOptions);
      return image3D;
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error(String(error));
      // Thử model tiếp theo (không throw ngay)
      continue;
    }
  }

  throw new Error(
    `Failed to generate 3D view (tried ${THREE_D_MODEL_CONFIGS.length} model(s)): ${lastError?.message ?? String(lastError)}`
  );
};
