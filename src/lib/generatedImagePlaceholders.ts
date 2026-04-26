const GENERATED_IMAGE_PLACEHOLDER_PATTERN = /\s*\[generated_image\]\s+ref=\/artifacts\/images\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+;\s+mime=image\/(?:jpeg|png|webp|gif)\s*/g;

export function stripGeneratedImagePlaceholders(text: string): string {
    return text.replace(GENERATED_IMAGE_PLACEHOLDER_PATTERN, ' ').replace(/[ \t]{2,}/g, ' ').trim();
}
