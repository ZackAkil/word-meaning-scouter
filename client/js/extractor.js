/**
 * Text Extractor
 * Extracts readable text from EPUB sections across the whole book (by page range or chapter).
 */

import { CHARS_PER_PAGE } from './reader.js';

export async function extractTextFromSpineSection(book, section) {
    if (!book || !section) return '';
    try {
        const content = await section.load(book.load.bind(book));
        if (typeof content === 'string') {
            const doc = new DOMParser().parseFromString(content, 'text/html');
            return (doc.body?.innerText || doc.body?.textContent || content).trim();
        }
        const bodyEl =
            content?.body ||
            content?.querySelector?.('body') ||
            section?.document?.body ||
            section?.document?.querySelector?.('body') ||
            content;
        return (bodyEl?.innerText || bodyEl?.textContent || '').trim();
    } catch (err) {
        console.warn('Spine extraction notice:', err);
    }
    return '';
}

export async function extractTextFromSpineHref(book, href) {
    if (!book || !href) return '';
    const cleanHref = href.split('#')[0];
    const section = book.spine.get(href) || book.spine.get(cleanHref);
    return extractTextFromSpineSection(book, section);
}

function sliceOnWordBoundaries(text, rawStart, rawEnd) {
    if (!text) return '';
    let start = Math.max(0, rawStart);
    let end = Math.min(text.length, rawEnd);

    if (start > 0 && !/\s/.test(text[start - 1]) && !/\s/.test(text[start])) {
        const prevSpace = text.lastIndexOf(' ', start);
        start = prevSpace !== -1 ? prevSpace + 1 : 0;
    }

    if (end < text.length && !/\s/.test(text[end - 1]) && !/\s/.test(text[end])) {
        const nextSpace = text.indexOf(' ', end);
        end = nextSpace !== -1 ? nextSpace : text.length;
    }

    return text.slice(start, end).trim();
}

export async function extractSelectionText({
    book,
    mode = 'chapter',
    startPage,
    endPage,
    chapterHref,
    fallbackIframeSelector = '#viewer iframe'
}) {
    if (!book) return '';

    // 1. Extract by Whole-Book Page Range
    if (mode === 'page-range' && startPage && endPage) {
        if (!book.locations?.length()) {
            await book.locations.generate(CHARS_PER_PAGE);
        }

        const totalPages = book.locations?.length() || 0;
        const spineItems = book.spine?.spineItems || [];

        if (totalPages > 0) {
            const minPage = Math.max(1, Math.min(startPage, endPage));
            const maxPage = Math.min(totalPages, Math.max(startPage, endPage));

            // Map every book page (1..totalPages) to its spine section
            const sectionPageBounds = new Map();
            for (let p = 1; p <= totalPages; p++) {
                const cfi = book.locations.cfiFromLocation(p - 1);
                if (!cfi) continue;

                const section =
                    book.spine.get(cfi) ||
                    spineItems.find((s) => s.cfiBase && cfi.includes(s.cfiBase));
                if (!section) continue;

                const key = section.index ?? section.href;
                const bounds = sectionPageBounds.get(key);
                if (!bounds) {
                    sectionPageBounds.set(key, {
                        section,
                        firstPage: p,
                        lastPage: p
                    });
                } else {
                    bounds.lastPage = p;
                }
            }

            const chunks = [];
            for (const { section, firstPage, lastPage } of sectionPageBounds.values()) {
                if (lastPage < minPage || firstPage > maxPage) {
                    continue;
                }

                const fullSectionText = await extractTextFromSpineSection(book, section);
                if (!fullSectionText) continue;

                const sectionTotalPages = Math.max(1, lastPage - firstPage + 1);
                const overlapStartPage = Math.max(firstPage, minPage);
                const overlapEndPage = Math.min(lastPage, maxPage);

                const startRatio = (overlapStartPage - firstPage) / sectionTotalPages;
                const endRatio = (overlapEndPage - firstPage + 1) / sectionTotalPages;

                const sliceStart = Math.floor(startRatio * fullSectionText.length);
                const sliceEnd = Math.ceil(endRatio * fullSectionText.length);
                const sliced = sliceOnWordBoundaries(fullSectionText, sliceStart, sliceEnd);

                if (sliced) {
                    console.log(
                        `[Word Meaning Scouter] Extracted spine section "${section.href}" (pages ${overlapStartPage}–${overlapEndPage} of section pages ${firstPage}–${lastPage}, ${sliced.length} chars)`
                    );
                    chunks.push(sliced);
                }
            }

            const combinedText = chunks.join('\n\n').trim();
            if (combinedText) return combinedText;
        }

        // Fallback if locations-to-spine mapping did not resolve: slice across all spine sections by CHARS_PER_PAGE
        if (spineItems.length > 0) {
            const minPage = Math.max(1, Math.min(startPage, endPage));
            const maxPage = Math.max(startPage, endPage);
            const startChar = (minPage - 1) * CHARS_PER_PAGE;
            const endChar = maxPage * CHARS_PER_PAGE;

            const allSectionsText = [];
            for (const section of spineItems) {
                const sectionText = await extractTextFromSpineSection(book, section);
                if (sectionText) allSectionsText.push(sectionText);
            }
            const fullBookText = allSectionsText.join('\n\n');
            const slicedBookText = sliceOnWordBoundaries(fullBookText, startChar, endChar);
            if (slicedBookText) return slicedBookText;
        }
    }

    // 2. Extract by Chapter
    if (mode === 'chapter' && chapterHref) {
        const text = await extractTextFromSpineHref(book, chapterHref);
        if (text.trim()) return text;
    }

    // 3. Fallback: First spine section
    if (book.spine?.length > 0) {
        const firstSection = book.spine.get(0);
        if (firstSection) {
            const text = await extractTextFromSpineSection(book, firstSection);
            if (text.trim()) return text;
        }
    }

    // 4. Fallback: Currently rendered iframe text
    const iframeDoc = document.querySelector(fallbackIframeSelector)?.contentDocument;
    return iframeDoc?.body?.innerText || iframeDoc?.body?.textContent || '';
}
