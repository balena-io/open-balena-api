-- create device types table

CREATE TABLE IF NOT EXISTS "device type table" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"slug" VARCHAR(255) NOT NULL UNIQUE
,	"name" VARCHAR(255) NOT NULL
);

-- populate device types table

INSERT INTO "device type table" ("slug", "name")
	SELECT "dt" AS "slug", "dt" AS "name" FROM
	(
		SELECT dt FROM
		(
			SELECT lower("device type") AS "dt" FROM "device"
			UNION
			SELECT lower("device type") AS "dt" FROM "application"
		) as DT_TABLE
	) as FULL_DT;


-- insert current dt from s3 as dts
INSERT INTO "device type table" ("slug", "name") VALUES
  (
    'am571x-evm',
    'AM571X EVM (DISCONTINUED)'
  ),
  (
    'apalis-imx6q',
    'Apalis iMX6q (DISCONTINUED)'
  ),
  (
    'artik533s',
    'Samsung Artik 530s 1G (EXPERIMENTAL)'
  ),
  (
    'odroid-xu4',
    'ODROID-XU4'
  ),
  (
    'asus-tinker-board',
    'Asus Tinker Board (EXPERIMENTAL)'
  ),
  (
    'blackboard-tx2',
    'Nvidia blackboard TX2'
  ),
  (
    'imx7-var-som',
    'Variscite VAR-SOM-MX7 (EXPERIMENTAL)'
  ),
  (
    'colibri-imx6dl',
    'Colibri iMX6dl (DISCONTINUED)'
  ),
  (
    'imx6ul-var-dart',
    'Variscite DART-6UL (EXPERIMENTAL)'
  ),
  (
    'jetson-tx1',
    'Nvidia Jetson TX1 (EXPERIMENTAL)'
  ),
  (
    'ccon-01',
    'CloudConnector 01 (EXPERIMENTAL)'
  ),
  (
    'orangepi-plus2',
    'Orange Pi Plus2 (EXPERIMENTAL)'
  ),
  (
    'raspberry-pi',
    'Raspberry Pi (v1 and Zero)'
  ),
  (
    'fincm3',
    'Balena Fin (CM3)'
  ),
  (
    'qemux86-64',
    'QEMU X86 64bit (EXPERIMENTAL)'
  ),
  (
    'orange-pi-zero',
    'Orange Pi Zero (EXPERIMENTAL)'
  ),
  (
    'kitra520',
    'RushUp Kitra 520 (DISCONTINUED)'
  ),
  (
    'jetson-tx2',
    'Nvidia Jetson TX2'
  ),
  (
    'artik10',
    'Samsung Artik 10 (DISCONTINUED)'
  ),
  (
    'qemux86',
    'QEMU X86 32bit (EXPERIMENTAL)'
  ),
  (
    'parallella',
    'Parallella (DISCONTINUED)'
  ),
  (
    'beaglebone-green-wifi',
    'BeagleBone Green Wireless (EXPERIMENTAL)'
  ),
  (
    'intel-nuc',
    'Intel NUC'
  ),
  (
    'artik5',
    'Samsung Artik 520 (DISCONTINUED)'
  ),
  (
    'artik710',
    'Samsung Artik 710 (DISCONTINUED)'
  ),
  (
    'asus-tinker-board-s',
    'Asus Tinker Board S (EXPERIMENTAL)'
  ),
  (
    'beagleboard-xm',
    'BeagleBoard-XM (EXPERIMENTAL)'
  ),
  (
    'jetson-nano',
    'Nvidia Jetson Nano (EXPERIMENTAL)'
  ),
  (
    'beaglebone-pocket',
    'PocketBeagle (EXPERIMENTAL)'
  ),
  (
    'intel-edison',
    'Intel Edison'
  ),
  (
    'npe-x500-m3',
    'NPE X500 M3'
  ),
  (
    'nitrogen6x',
    'Nitrogen 6X (DISCONTINUED)'
  ),
  (
    'imx8m-var-dart',
    'Variscite DART-MX8M (EXPERIMENTAL)'
  ),
  (
    'beaglebone-green',
    'BeagleBone Green (EXPERIMENTAL)'
  ),
  (
    'odroid-c1',
    'ODROID-C1+'
  ),
  (
    'generic-aarch64',
    'Generic AARCH64 (ARMv8) (EXPERIMENTAL)'
  ),
  (
    'iot2000',
    'Siemens IOT2000 (EXPERIMENTAL)'
  ),
  (
    'orange-pi-one',
    'Orange Pi One (EXPERIMENTAL)'
  ),
  (
    'orbitty-tx2',
    'CTI Orbitty TX2 (EXPERIMENTAL)'
  ),
  (
    'kitra710',
    'RushUp Kitra 710 (DISCONTINUED)'
  ),
  (
    'raspberrypi3-64',
    'Raspberry Pi 3 (using 64bit OS) (EXPERIMENTAL)'
  ),
  (
    'beaglebone-black',
    'BeagleBone Black'
  ),
  (
    'bananapi-m1-plus',
    'BananaPi-M1+ (EXPERIMENTAL)'
  ),
  (
    'artik530',
    'Samsung Artik 530 (DISCONTINUED)'
  ),
  (
    'jetson-tx2-skycatch',
    'Nvidia Jetson TX2 Skycatch (EXPERIMENTAL)'
  ),
  (
    'hummingboard',
    'Hummingboard'
  ),
  (
    'cl-som-imx8',
    'Compulab MX8M (EXPERIMENTAL)'
  ),
  (
    'raspberry-pi2',
    'Raspberry Pi 2'
  ),
  (
    'cybertan-ze250',
    'Cybertan ZE250 (DISCONTINUED)'
  ),
  (
    'raspberrypi3',
    'Raspberry Pi 3'
  ),
  (
    'revpi-core-3',
    'Revolution Pi Core 3'
  ),
  (
    'n510-tx2',
    'Aetina N510 TX2 (EXPERIMENTAL)'
  ),
  (
    'skx2',
    'SKX2 (EXPERIMENTAL)'
  ),
  (
    'spacely-tx2',
    'CTI Spacely TX2 (EXPERIMENTAL)'
  ),
  (
    'srd3-tx2',
    'Nvidia D3 TX2'
  ),
  (
    'up-board',
    'UP board'
  ),
  (
    'ts7700',
    'Technologic TS-7700 (DISCONTINUED)'
  ),
  (
    'var-som-mx6',
    'Variscite VAR-SOM-MX6 (EXPERIMENTAL)'
  ),
  (
    'ts4900',
    'Technologic TS-4900'
  ),
  (
    'via-vab820-quad',
    'VIA VAB 820-quad (DISCONTINUED)'
  ),
  (
    'zynq-xz702',
    'Zynq ZC702 (DISCONTINUED)'
  )
ON CONFLICT ON CONSTRAINT "device type table_slug_key"
DO UPDATE SET "name" = EXCLUDED.name;

-- fix up application table

ALTER TABLE "application" ADD COLUMN "is for-device type table" INTEGER NULL;

ALTER TABLE "application"
ADD CONSTRAINT "application_is for-device type_fkey" FOREIGN KEY ("is for-device type table") REFERENCES "device type table" ("id");

-- fix up device table

ALTER TABLE "device" ADD COLUMN "is of-device type table" INTEGER NULL;

ALTER TABLE "device"
ADD CONSTRAINT "device_is-device type_fkey" FOREIGN KEY ("is of-device type table") REFERENCES "device type table" ("id");

