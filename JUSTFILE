# Show all available recipes.
help:
    @just -l --unsorted

# Create a new Markdown blog post.
md title:
    node scripts/new-post.mjs md "{{title}}"

# Create a new MDX blog post.
mdx title:
    node scripts/new-post.mjs mdx "{{title}}"
