DROP TABLE IF EXISTS "testa";

CREATE TABLE IF NOT EXISTS "testa" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
,	"id" BIGINT NOT NULL PRIMARY KEY
,	"columnA" VARCHAR(255) NOT NULL UNIQUE
,	"columnB" VARCHAR(255) NOT NULL
,	"columnC" VARCHAR(255) NULL
);


INSERT INTO "testa" ("id","columnA", "columnB", "columnC")
VALUES 
(1,'a001','b001', NULL),
(2,'a002','b002', NULL),
(3,'a003','b003', NULL), 
(4,'a004','b004', NULL),
(5,'a005','b005', NULL),
(6,'a006','b006', NULL),
(7,'a007','b007', NULL),
(8,'a008','b008', NULL),
(9,'a009','b009', NULL),
(10,'a010','b010', NULL),
(11,'a011','b011', NULL),
(12,'a012','b012', NULL);

DROP TABLE IF EXISTS "testb";

CREATE TABLE IF NOT EXISTS "testb" (
	"created at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
,	"id" BIGINT NOT NULL PRIMARY KEY
,	"columnA" VARCHAR(255) NOT NULL UNIQUE
,	"columnB" VARCHAR(255) NOT NULL
,	"columnC" VARCHAR(255) NULL
);


INSERT INTO "testb" ("id","columnA", "columnB", "columnC")
VALUES 
(1,'a001','b001', NULL),
(2,'a002','b002', NULL),
(3,'a003','b003', NULL), 
(4,'a004','b004', NULL),
(5,'a005','b005', NULL),
(6,'a006','b006', NULL),
(7,'a007','b007', NULL),
(8,'a008','b008', NULL),
(9,'a009','b009', NULL),
(10,'a010','b010', NULL),
(11,'a011','b011', NULL),
(12,'a012','b012', NULL);