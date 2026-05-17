// ==UserScript==
// @name         Basic Fixture
// @namespace    https://example.com/basic
// @version      1.0.0
// @description  Compiler CLI fixture.
// @match        https://example.com/*
// @grant        GM.getValue
// @grant        GM.setValue
// ==/UserScript==

(async () => {
  const visits = await GM.getValue('visits', 0);
  await GM.setValue('visits', visits + 1);
})();
