CREATE TABLE IF NOT EXISTS "device metrics record" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"is reported by-device" INTEGER NOT NULL UNIQUE
,	"memory usage" INTEGER NULL
,	"memory total" INTEGER NULL
,	"storage block device" VARCHAR(255) NULL
,	"storage usage" INTEGER NULL
,	"storage total" INTEGER NULL
,	"cpu usage" INTEGER NULL
,	"cpu temp" INTEGER NULL
,	"is undervolted" BOOLEAN DEFAULT FALSE NOT NULL
,	FOREIGN KEY ("is reported by-device") REFERENCES "device" ("id")
);


CREATE INDEX IF NOT EXISTS "device_metrics_record_by_device_idx"
ON "device metrics record" ("is reported by-device");
