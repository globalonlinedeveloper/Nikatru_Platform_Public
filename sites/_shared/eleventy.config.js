/**
 * @nikatru/site-shared — Eleventy v3 config (ESM).
 *
 * Input is the package root itself; `demo/` provides a smoke-test page that
 * exercises the base layout, partials, and `_data/apps.json`.
 */
export default function (eleventyConfig) {
  // Static assets (design tokens + shared base styles) are copied as-is.
  eleventyConfig.addPassthroughCopy("assets");

  // Docs/config files are not pages.
  eleventyConfig.ignores.add("README.md");

  // {% year %} — current year, e.g. for the footer copyright line.
  eleventyConfig.addShortcode("year", () => String(new Date().getFullYear()));

  // | jsonify — serialize a template object (used for JSON-LD in seo.njk).
  eleventyConfig.addFilter("jsonify", (value) => JSON.stringify(value));

  return {
    dir: {
      input: ".",
      output: "_site",
      includes: "_includes",
      data: "_data"
    },
    templateFormats: ["njk", "md", "html"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk"
  };
}
