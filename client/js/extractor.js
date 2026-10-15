/**
 * Text Extractor
 * Extracts readable text from EPUB sections (by page range or chapter).
 */

export async function extractTextFromSpineHref(book, href) {
    if (!book || !href) return '';
    try {
        const section = book.spine.get(href);
        if (section) {
            const content = await section.load(book.load.bind(book));
            if (typeof content === 'string') {
                const doc = new DOMParser().parseFromString(content, 'text/html');
                return doc.body?.innerText || doc.body?.textContent || content;
            }
            return content?.body?.innerText || content?.body?.textContent || '';
        }
    } catch (err) {
        console.warn('Spine extraction notice:', err);
    }
    return '';
}

export async function extractSelectionText({ book, mode = 'chapter', startPage, endPage, chapterHref, fallbackIframeSelector = '#viewer iframe' }) {
    if (!book) return '';

    // 1. Extract by Page Range
    if (mode === 'page-range' && startPage && endPage && book.locations?.length()) {
        let combinedText = '';
        const visitedHrefs = new Set();
        const minPage = Math.max(1, startPage);
        const maxPage = Math.min(endPage, book.locations.length());

        for (let p = minPage; p <= maxPage; p++) {
            const cfi = book.locations.cfiFromLocation(p - 1);
            if (cfi) {
                const item = book.spine.get(cfi);
                if (item && !visitedHrefs.has(item.href)) {
                    visitedHrefs.add(item.href);
                    const text = await extractTextFromSpineHref(book, item.href);
                    combinedText += `\n${text}`;
                }
            }
        }

        if (combinedText.trim()) return combinedText;
    }

    // 2. Extract by Chapter
    if (mode === 'chapter' && chapterHref) {
        const text = await extractTextFromSpineHref(book, chapterHref);
        if (text.trim()) return text;
    }

    // 3. Fallback: First spine section
    if (book.spine?.length > 0) {
        const firstHref = book.spine.get(0)?.href;
        if (firstHref) {
            const text = await extractTextFromSpineHref(book, firstHref);
            if (text.trim()) return text;
        }
    }

    // 4. Fallback: Currently rendered iframe text
    const iframeDoc = document.querySelector(fallbackIframeSelector)?.contentDocument;
    return iframeDoc?.body?.innerText || iframeDoc?.body?.textContent || '';
}
