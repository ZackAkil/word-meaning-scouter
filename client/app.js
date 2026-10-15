/**
 * Word Meaning Scouter Main Application Controller
 */

import { checkSecurityStatus } from './api_client.js';
import { EpubReader } from './js/reader.js';
import { extractSelectionText } from './js/extractor.js';
import { fetchVocabulary, renderCruxParagraph, renderVocabGrid, showWordDetail, hideWordDetail, renderPrintSheet } from './js/vocab.js';

document.addEventListener('DOMContentLoaded', () => {
    checkSecurityStatus().catch((err) => console.warn('Status check failed:', err));

    const state = {
        currentChapterHref: null,
        currentChapterLabel: '',
        words: [],
        cruxParagraph: '',
        revealed: new Set(),
        activeWordIndex: null,
        currentScope: ''
    };

    const elements = {
        startView: document.getElementById('start-view'),
        mainWorkspace: document.getElementById('main-workspace'),
        startFileInput: document.getElementById('start-file-input'),
        changeFileInput: document.getElementById('change-file-input'),
        bookTitle: document.getElementById('book-title'),
        modeRadios: document.querySelectorAll('input[name="selection-mode"]'),
        tocSelect: document.getElementById('toc-select'),
        pageStart: document.getElementById('page-start'),
        pageEnd: document.getElementById('page-end'),
        wordCount: document.getElementById('word-count'),
        includeCrux: document.getElementById('include-crux'),
        extractBtn: document.getElementById('extract-btn'),
        prevBtn: document.getElementById('prev-btn'),
        nextBtn: document.getElementById('next-btn'),
        pageInfo: document.getElementById('page-info'),
        vocabSection: document.getElementById('vocab-section'),
        vocabSubtitle: document.getElementById('vocab-subtitle'),
        vocabLoading: document.getElementById('vocab-loading'),
        vocabError: document.getElementById('vocab-error'),
        cruxBox: document.getElementById('crux-box'),
        cruxText: document.getElementById('crux-text'),
        vocabGrid: document.getElementById('vocab-grid'),
        printSheetBtn: document.getElementById('print-sheet-btn'),
        printDialog: document.getElementById('print-dialog'),
        printFormatRadios: document.querySelectorAll('input[name="print-format"]'),
        printSheetMeta: document.getElementById('print-sheet-meta'),
        printSheetBody: document.getElementById('print-sheet-body'),
        doPrintBtn: document.getElementById('do-print-btn'),
        closePrintDialogBtn: document.getElementById('close-print-dialog-btn'),
        wordDetail: {
            dialog: document.getElementById('word-detail-dialog'),
            word: document.getElementById('detail-word'),
            pos: document.getElementById('detail-pos'),
            pron: document.getElementById('detail-pron'),
            definitions: document.getElementById('detail-definitions'),
            example: document.getElementById('detail-example'),
            closeBtn: document.getElementById('detail-close-btn')
        }
    };

    const reader = new EpubReader({
        viewerId: 'viewer',
        onMetadata: (meta) => {
            if (meta?.title) elements.bookTitle.textContent = meta.title;
        },
        onNavigation: (nav) => {
            populateToc(nav.toc);
        },
        onLocationsReady: (totalPages) => {
            if (totalPages > 0) {
                elements.pageStart.max = totalPages;
                elements.pageEnd.max = totalPages;
                elements.pageStart.placeholder = '1';
                elements.pageEnd.placeholder = `${totalPages}`;
            }
        },
        onRelocated: updatePaginationUI
    });

    initEventListeners();

    function initEventListeners() {
        if (elements.startFileInput) elements.startFileInput.addEventListener('change', handleFileUpload);
        if (elements.changeFileInput) elements.changeFileInput.addEventListener('change', handleFileUpload);

        elements.prevBtn.addEventListener('click', () => reader.prev());
        elements.nextBtn.addEventListener('click', () => reader.next());
        elements.tocSelect.addEventListener('change', handleChapterSelect);
        elements.extractBtn.addEventListener('click', handleExtractVocabulary);
        elements.wordDetail.closeBtn.addEventListener('click', () => hideWordDetail(elements.wordDetail));
        elements.wordDetail.dialog?.addEventListener('close', () => {
            document.querySelectorAll('.vocab-tile').forEach((t) => t.classList.remove('active-selected'));
        });
        elements.wordDetail.dialog?.addEventListener('click', (e) => {
            if (e.target === elements.wordDetail.dialog) {
                hideWordDetail(elements.wordDetail);
            }
        });

        if (elements.printSheetBtn) {
            elements.printSheetBtn.addEventListener('click', handleOpenPrintSheet);
        }
        if (elements.doPrintBtn) {
            elements.doPrintBtn.addEventListener('click', () => window.print());
        }
        if (elements.closePrintDialogBtn) {
            elements.closePrintDialogBtn.addEventListener('click', () => elements.printDialog?.close());
        }

        elements.printFormatRadios?.forEach((radio) => {
            radio.addEventListener('change', () => {
                if (!state.words || state.words.length === 0) return;
                const format = document.querySelector('input[name="print-format"]:checked')?.value || 'single';
                renderPrintSheet(elements.printSheetBody, state.words, format);
            });
        });

        elements.modeRadios.forEach((radio) => {
            radio.addEventListener('change', updateSelectionModeUI);
        });

        elements.pageStart.addEventListener('change', () => {
            const pageNum = parseInt(elements.pageStart.value, 10);
            if (pageNum) reader.displayPage(pageNum);
        });

        document.addEventListener('keyup', (e) => {
            if (document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
            if (e.key === 'ArrowLeft') reader.prev();
            else if (e.key === 'ArrowRight') reader.next();
        });
    }

    function handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        elements.bookTitle.textContent = file.name.replace(/\.epub$/i, '');
        elements.startView.classList.add('hidden');
        elements.mainWorkspace.classList.remove('hidden');
        elements.vocabSection.classList.add('hidden');

        const fileReader = new FileReader();
        fileReader.onload = (event) => {
            reader.load(event.target.result);
            enableControls();
        };
        fileReader.readAsArrayBuffer(file);
    }

    function enableControls() {
        elements.prevBtn.disabled = false;
        elements.nextBtn.disabled = false;
        elements.extractBtn.disabled = false;
        updateSelectionModeUI();
    }

    function updateSelectionModeUI() {
        const bookLoaded = !!reader.getBook();
        if (!bookLoaded) {
            elements.tocSelect.disabled = true;
            elements.pageStart.disabled = true;
            elements.pageEnd.disabled = true;
            return;
        }

        const selectedMode = document.querySelector('input[name="selection-mode"]:checked')?.value || 'chapter';
        if (selectedMode === 'chapter') {
            elements.tocSelect.disabled = false;
            elements.pageStart.disabled = true;
            elements.pageEnd.disabled = true;
        } else {
            elements.tocSelect.disabled = true;
            elements.pageStart.disabled = false;
            elements.pageEnd.disabled = false;
        }
    }

    function populateToc(toc) {
        elements.tocSelect.innerHTML = '<option value="">Select Chapter</option>';

        function addItems(items, depth = 0) {
            items.forEach((item) => {
                const option = document.createElement('option');
                option.value = item.href;
                option.textContent = `${'\u00A0'.repeat(depth * 3)}${item.label.trim()}`;
                elements.tocSelect.appendChild(option);

                if (!state.currentChapterHref) {
                    state.currentChapterHref = item.href;
                    state.currentChapterLabel = item.label.trim();
                }

                if (item.subitems?.length) addItems(item.subitems, depth + 1);
            });
        }

        addItems(toc);
    }

    function handleChapterSelect(e) {
        const href = e.target.value;
        if (href) {
            state.currentChapterHref = href;
            state.currentChapterLabel = e.target.options[e.target.selectedIndex].text.trim();
            reader.display(href);
        }
    }

    function updatePaginationUI(location) {
        if (!location?.start) return;

        elements.prevBtn.disabled = !!location.atStart;
        elements.nextBtn.disabled = !!location.atEnd;

        const book = reader.getBook();
        if (location.start.displayed?.page && location.start.displayed?.total) {
            elements.pageInfo.textContent = `Page ${location.start.displayed.page} of ${location.start.displayed.total}`;
        } else if (book?.locations?.length()) {
            const current = book.locations.locationFromCfi(location.start.cfi) + 1;
            elements.pageInfo.textContent = `Page ${current} of ${book.locations.length()}`;
        } else {
            elements.pageInfo.textContent = '';
        }
    }

    function handleOpenPrintSheet() {
        if (!state.words || state.words.length === 0) return;

        const title = elements.bookTitle.textContent || 'Book';
        if (elements.printSheetMeta) {
            elements.printSheetMeta.textContent = `${title} • ${state.currentScope} (${state.words.length} cards)`;
        }

        const format = document.querySelector('input[name="print-format"]:checked')?.value || 'single';
        renderPrintSheet(elements.printSheetBody, state.words, format);
        elements.printDialog?.showModal();
    }

    async function handleExtractVocabulary() {
        const book = reader.getBook();
        if (!book) return;

        const targetCount = parseInt(elements.wordCount?.value, 10) || 16;
        const includeCrux = !!elements.includeCrux?.checked;
        const mode = document.querySelector('input[name="selection-mode"]:checked')?.value || 'chapter';
        const startPage = parseInt(elements.pageStart.value, 10);
        const endPage = parseInt(elements.pageEnd.value, 10);

        let scope = '';
        if (mode === 'page-range') {
            if (!startPage || !endPage) {
                elements.vocabSubtitle.textContent = 'Please enter both Start and End page numbers.';
                elements.vocabSection.classList.remove('hidden');
                elements.vocabError.textContent = 'Please enter a valid page range (e.g. 1 to 20).';
                elements.vocabError.classList.remove('hidden');
                if (elements.printSheetBtn) elements.printSheetBtn.disabled = true;
                return;
            }
            scope = `Pages ${startPage}–${endPage}`;
        } else {
            scope = state.currentChapterLabel || 'Selected Chapter';
        }

        state.currentScope = scope;

        elements.vocabSubtitle.textContent = `${scope} • ${targetCount} Words`;
        elements.vocabSection.classList.remove('hidden');
        elements.vocabLoading.classList.remove('hidden');
        elements.vocabError.classList.add('hidden');
        elements.cruxBox?.classList.add('hidden');
        elements.vocabGrid.classList.add('hidden');
        if (elements.printSheetBtn) elements.printSheetBtn.disabled = true;
        hideWordDetail(elements.wordDetail);

        state.revealed.clear();
        state.activeWordIndex = null;
        elements.vocabSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

        function selectWordTile(index, item, tileEl) {
            const tile = tileEl || elements.vocabGrid.querySelector(`.vocab-tile[data-index="${index}"]`);
            state.revealed.add(index);
            if (tile) {
                tile.classList.add('revealed');
                if (!tile.querySelector('.tile-badge')) {
                    const badge = document.createElement('span');
                    badge.className = 'tile-badge';
                    badge.textContent = 'Revealed';
                    tile.appendChild(badge);
                }
            }

            document.querySelectorAll('.vocab-tile').forEach((t) => t.classList.remove('active-selected'));
            if (tile) tile.classList.add('active-selected');
            state.activeWordIndex = index;

            showWordDetail(item, elements.wordDetail);
        }

        try {
            const text = await extractSelectionText({
                book,
                mode,
                startPage,
                endPage,
                chapterHref: elements.tocSelect.value || state.currentChapterHref
            });

            if (!text.trim()) {
                throw new Error('Unable to extract readable text for the selected chapter/pages.');
            }

            const result = await fetchVocabulary({ text, targetCount, includeCrux });
            state.words = result.words;
            state.cruxParagraph = result.cruxParagraph;

            if (!state.words.length) {
                throw new Error('No tricky vocabulary words found for this selection.');
            }

            renderVocabGrid(elements.vocabGrid, state.words, selectWordTile);
            renderCruxParagraph(
                elements.cruxBox,
                elements.cruxText,
                state.cruxParagraph,
                state.words,
                (index, item) => selectWordTile(index, item)
            );

            if (elements.printSheetBtn) elements.printSheetBtn.disabled = false;
            elements.vocabLoading.classList.add('hidden');
            elements.vocabGrid.classList.remove('hidden');
        } catch (err) {
            elements.vocabLoading.classList.add('hidden');
            elements.vocabError.textContent = err.message;
            elements.vocabError.classList.remove('hidden');
            if (elements.printSheetBtn) elements.printSheetBtn.disabled = true;
        }
    }
});
