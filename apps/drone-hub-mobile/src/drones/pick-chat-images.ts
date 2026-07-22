import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_IMAGES = 8;

export type MobileChatAttachment = {
  id: string;
  uri: string;
  name: string;
  mime: string;
  size: number;
  bytes: Uint8Array;
};

export type MobileChatImage = MobileChatAttachment;

function imageMime(value: unknown, name: string): string {
  const supplied = String(value ?? '')
    .trim()
    .toLowerCase();
  if (supplied) return supplied;
  if (/\.png$/iu.test(name)) return 'image/png';
  if (/\.jpe?g$/iu.test(name)) return 'image/jpeg';
  if (/\.gif$/iu.test(name)) return 'image/gif';
  if (/\.webp$/iu.test(name)) return 'image/webp';
  return '';
}

export async function pickChatImages(
  existing: readonly MobileChatImage[],
): Promise<MobileChatImage[]> {
  if (existing.length >= MAX_IMAGES)
    throw new Error(`A prompt can include up to ${MAX_IMAGES} images.`);
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Photo access is required to attach an image.');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: MAX_IMAGES - existing.length,
    quality: 0.9,
  });
  if (result.canceled) return [];
  if (result.assets.length > MAX_IMAGES - existing.length)
    throw new Error(`A prompt can include up to ${MAX_IMAGES} images.`);
  const selected: MobileChatImage[] = [];
  let totalBytes = existing.reduce((total, image) => total + image.size, 0);
  for (const asset of result.assets) {
    const file = new File(asset.uri);
    const name = String(
      asset.fileName ?? file.name ?? `image-${existing.length + selected.length + 1}`,
    );
    const mime = imageMime(asset.mimeType ?? file.type, name);
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'].includes(mime))
      throw new Error(`Unsupported image type: ${mime || 'unknown'}. Use PNG, JPEG, GIF, or WebP.`);
    const reportedSize = Number(asset.fileSize ?? file.size ?? 0);
    if (!Number.isSafeInteger(reportedSize) || reportedSize <= 0)
      throw new Error('The selected image is empty.');
    if (reportedSize > MAX_IMAGE_BYTES)
      throw new Error('Each prompt image must be 6 MiB or smaller.');
    const bytes = await file.bytes();
    const size = bytes.length;
    if (size <= 0) throw new Error('The selected image is empty.');
    if (size > MAX_IMAGE_BYTES) throw new Error('Each prompt image must be 6 MiB or smaller.');
    totalBytes += size;
    if (totalBytes > MAX_TOTAL_BYTES)
      throw new Error('Prompt images must be 20 MiB or smaller in total.');
    selected.push({
      id: `${asset.assetId ?? asset.uri}:${size}:${existing.length + selected.length}`,
      uri: asset.uri,
      name,
      mime: mime === 'image/jpg' ? 'image/jpeg' : mime,
      size,
      bytes,
    });
  }
  return selected;
}
