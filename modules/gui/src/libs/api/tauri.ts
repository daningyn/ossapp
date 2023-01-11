/**
 * this is the main api integration, anything added here
 * should be mock replicated in ./mock.ts
 *  why? to make it easier to verify features without us always
 *    going through
 *      the build->download->install->test loop
 *      thus saving us so much time
 *
 * primary concerns here are any method that does the following:
 *  - connect to remote api(api.tea.xyz) and returns a data
 *  - connect to a local platform api and returns a data
 */
import { getClient } from '@tauri-apps/api/http';
// import { invoke } from '@tauri-apps/api';
import { Command } from '@tauri-apps/api/shell';
import { readDir, BaseDirectory } from '@tauri-apps/api/fs';

import type { Package, Review, AirtablePost, Developer, Bottle } from '@tea/ui/types';
import type { GUIPackage, Course, Category, AuthStatus } from '../types';

import * as mock from './mock';
import { PackageStates } from '../types';
import { getSession } from '$libs/stores/auth';
import type { Session } from '$libs/stores/auth';
import { getInstalledPackages } from '$libs/teaDir';
import bcrypt from 'bcryptjs';

export const apiBaseUrl = 'https://api.tea.xyz/v1';
// export const apiBaseUrl = 'http://localhost:3000/v1';

async function getHeaders(path: string, session: Session) {
	const unixMs = new Date().getTime();
	const unixHexSecs = Math.round(unixMs / 1000).toString(16); // hex
	const deviceId = session.device_id?.split('-')[0];
	const preHash = [unixHexSecs, session.key, deviceId, path].join('');

	const Authorization = bcrypt.hashSync(preHash, 10);

	return {
		Authorization,
		['tea-ts']: unixMs.toString(),
		['tea-uid']: session.user?.developer_id,
		['tea-gui_id']: session.device_id
	};
}

async function get<T>(path: string, query?: { [key: string]: string }) {
	const [session, client] = await Promise.all([getSession(), getClient()]);

	const uri = join(apiBaseUrl, path);

	const headers =
		session?.device_id && session?.user
			? await getHeaders(`GET/${path}`, session)
			: { Authorization: 'public ' };

	const { data } = await client.get<T>(uri.toString(), {
		headers,
		query: query || {}
	});
	return data;
}

const join = function (...paths: string[]) {
	return paths
		.map(function (path) {
			if (path[0] === '/') {
				path = path.slice(1);
			}
			if (path[path.length - 1] === '/') {
				path = path.slice(0, path.length - 1);
			}
			return path;
		})
		.join('/');
};

export async function getPackages(): Promise<GUIPackage[]> {
	const [packages, installedPackages] = await Promise.all([
		get<Package[]>('packages'),
		getInstalledPackages()
	]);

	return packages.map((pkg) => {
		const found = installedPackages.find((p) => p.full_name === pkg.full_name);
		return {
			...pkg,
			state: found ? PackageStates.INSTALLED : PackageStates.AVAILABLE,
			installed_version: found ? found.version : ''
		};
	});
}

export async function getFeaturedPackages(): Promise<Package[]> {
	const packages = await mock.getFeaturedPackages();
	return packages;
}

export async function getPackageReviews(full_name: string): Promise<Review[]> {
	console.log(`getting reviews for ${full_name}`);
	const reviews: Review[] = await get<Review[]>(
		`packages/${full_name.replaceAll('/', ':')}/reviews`
	);

	return reviews;
}

export async function installPackage(full_name: string) {
	try {
		await installPackageCommand(full_name);
	} catch (error) {
		console.error(error);
	}
}

async function installPackageCommand(full_name: string) {
	return new Promise((resolve, reject) => {
		const teaInstallCommand = new Command('tea-install', [`+${full_name}`, 'true']);
		teaInstallCommand.on('error', reject);

		const handleLineOutput = async (line: string | { code: number }) => {
			const c = await child;
			if (
				(typeof line === 'string' && line.includes('installed:')) ||
				(typeof line !== 'string' && line?.code === 0)
			) {
				c.kill();
				resolve(c.pid);
			} else if (typeof line !== 'string' && line?.code === 1) {
				reject();
			}
		};

		teaInstallCommand.stdout.on('data', handleLineOutput);
		teaInstallCommand.stderr.on('data', handleLineOutput);
		teaInstallCommand.on('close', (line: string) => {
			console.log('command closed!');
			handleLineOutput(line || '');
		});
		teaInstallCommand.on('error', (line: string) => {
			console.log('command error!', line);
			handleLineOutput(line || '');
		});
		const child = teaInstallCommand.spawn();
	});
}

export async function getFeaturedCourses(): Promise<Course[]> {
	const posts = await get<AirtablePost[]>('posts', { tag: 'featured_course' });
	return posts.map((post) => {
		return {
			title: post.title,
			sub_title: post.sub_title,
			banner_image_url: post.thumb_image_url,
			link: post.link
		} as Course;
	});
}

export async function getTopPackages(): Promise<GUIPackage[]> {
	const packages = await mock.getTopPackages();
	return packages;
}

export async function getAllPosts(tag?: string): Promise<AirtablePost[]> {
	// add filter here someday: tag = news | course
	const posts = await get<AirtablePost[]>('posts', tag ? { tag } : {});
	return posts;
}

export async function getCategorizedPackages(): Promise<Category[]> {
	const categories = await get<Category[]>('/packages/categorized');
	return categories;
}

type DeviceAuth = {
	status: AuthStatus;
	user: Developer;
	key: string;
};

export async function getDeviceAuth(deviceId: string): Promise<DeviceAuth> {
	const data = await get<DeviceAuth>(`/auth/device/${deviceId}`);
	return data;
}

export async function getPackageBottles(packageName: string): Promise<Bottle[]> {
	console.log('getting bottles for ', packageName);
	const client = await getClient();
	const uri = join('https://app.tea.xyz/api/bottles/', packageName);
	const { data } = await client.get<Bottle[]>(uri.toString());
	console.log('got bottles', data);
	return data;
}

export async function registerDevice(): Promise<string> {
	const { deviceId } = await get<{ deviceId: string }>('/auth/registerDevice');
	return deviceId;
}
