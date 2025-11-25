// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightBlog from 'starlight-blog';

// https://astro.build/config
export default defineConfig({
	site: 'https://tsunghanyu.com',
	integrations: [
		starlight({
			plugins: [starlightBlog()],
			title: 'Tsung-Han Yu',
			favicon: 'favicon.ico',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/johan456789/johan456789.github.io' }],
			sidebar: [
				{
					label: 'Guides',
					items: [
						// Each item here is one entry in the navigation menu.
						{ label: 'Example Guide', slug: 'guides/example' },
					],
				},
				{
					label: 'Reference',
					autogenerate: { directory: 'reference' },
				},
			],
		}),
	],
});
