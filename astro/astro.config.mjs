// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'Tsung-Han Yu',
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
					label: 'Blog',
					items: [
						{ label: 'First Post - Why Blog', slug: 'posts/first-post' },
						{ label: 'Why Password Managers Are Both More Convenient and Secure', slug: 'posts/why-password-managers-are-both-more-convenient-and-secure' },
						{ label: 'Blog Update', slug: 'posts/blog-update' },
						{ label: 'Book Review: Collywobbles', slug: 'posts/book-review-collywobbles' },
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
