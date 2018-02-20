declare module '@resin.io/device-types' {
	interface DeviceType {
		slug: string;
		name: string;

		arch: string;
		state?: string;

		isDependent?: boolean;
		instructions?: string[] | DeviceTypeInstructions;
		gettingStartedLink?: string | DeviceTypeGettingStartedLink;
		stateInstructions?: { [key: string]: string[] };
		options?: DeviceTypeOptions[];
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

	interface Option {
		message: string;
		name: string;
	}

	interface DeviceTypeOptions extends Option {
		options: DeviceTypeOptionsGroup[];
		collapsed: boolean;
		isCollapsible: boolean;
		isGroup: boolean;
	}

	interface DeviceInitializationOptions extends Option {
		type: string;
	}

	interface DeviceTypeOptionsGroup extends Option {
		default: number | string;
		type: string;
		min?: number;
		choices?: string[] | number[];
		choicesLabels?: { [key: string]: string };
	}

	export function buildManifest(
		manifest,
		slug,
		opts: { partial: true },
	): DeviceType;
	export function normalizeDeviceType(
		deviceTypes: DeviceType[],
		slug: string,
	): string;
	export function findBySlug(
		deviceTypes: DeviceType[],
		slug: string,
	): Promise<DeviceType | undefined>;
}
