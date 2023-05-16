export interface DeviceTypeJson {
	slug: string;
	name: string;
	aliases?: string[];
	logoUrl?: string;

	arch: string;
	state?: string;
	private?: boolean;

	isDependent?: boolean;
	instructions?: string[] | DeviceTypeInstructions;
	gettingStartedLink?: string | DeviceTypeGettingStartedLink;
	stateInstructions?: { [key: string]: string[] };
	options?: Array<DeviceTypeOptions | DeviceTypeOptionsGroup>;
	initialization?: {
		options?: DeviceInitializationOptions[];
		operations: Array<{
			command: string;
		}>;
	};
	supportsBlink?: boolean;
	yocto: {
		fstype?: string;
		deployArtifact: string;
		machine?: string;
		image?: string;
		version?: string;
		deployFlasherArtifact?: string;
		deployRawArtifact?: string;
		compressed?: boolean;
		archive?: boolean;
	};
	// Holds the latest resinOS version
	buildId: string;
}
interface DeviceTypeInstructions {
	linux: string[];
	osx: string[];
	windows: string[];
}

interface DeviceTypeGettingStartedLink {
	linux: string;
	osx: string;
	windows: string;
	[key: string]: string;
}

interface DeviceTypeOptionBase {
	message: string;
	name: string;
}

interface DeviceTypeOptions extends DeviceTypeOptionBase {
	options: DeviceTypeOptionsGroup[];
	collapsed?: boolean;
	isCollapsible?: boolean;
	isGroup: boolean;
}

interface DeviceInitializationOptions extends DeviceTypeOptionBase {
	type: string;
}

interface DeviceTypeOptionsGroup extends DeviceTypeOptionBase {
	default?: number | string;
	type: string;
	min?: number;
	choices?: string[] | number[];
	choicesLabels?: { [key: string]: string };
}
