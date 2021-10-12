-- Optimize the overall status computed fact type
CREATE INDEX IF NOT EXISTS "image_install_status_dl_progress_device_idx"
ON "image install" ("status", "download progress", "device");
