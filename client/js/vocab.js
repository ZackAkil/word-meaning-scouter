/**
 * Vocabulary UI Manager
 * Handles protected API communication, grid rendering, word definition display, and printable flashcards.
 */

import { postProtected } from '../api_client.js';

export const MAX_TEXT_CHARS = 60000;

export async function fetchVocabulary({ text, targetCount = 16, includeCrux = false }) {
    console.log(`[Word Meaning Scouter] Analysing text section (${text.length} chars):\n`, text);

    if (text.length > MAX_TEXT_CHARS) {
        throw new Error(
            `Selected text is ${text.length.toLocaleString()} characters, which exceeds the maximum limit of ${MAX_TEXT_CHARS.toLocaleString()} characters. Please select a smaller page range.`
        );
    }

    const data = await postProtected('/api/extract-vocabulary', {
        text,
        target_count: targetCount,
        include_crux: includeCrux
    });
    return {
        words: data.words || [],
        cruxParagraph: data.crux_paragraph || ''
    };
}

export function renderCruxParagraph(boxEl, textEl, cruxParagraph, words, onWordSelect) {
    if (!boxEl || !textEl) return;

    if (!cruxParagraph || !cruxParagraph.trim()) {
        textEl.innerHTML = '';
        boxEl.classList.add('hidden');
        return;
    }

    let html = escapeHtml(cruxParagraph);

    if (Array.isArray(words) && words.length > 0) {
        const entries = words
            .map((item, index) => ({
                index,
                wordLower: (item.word || '').trim().toLowerCase(),
                escapedStem: (item.word || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            }))
            .filter((e) => e.escapedStem.length > 0)
            .sort((a, b) => b.escapedStem.length - a.escapedStem.length);

        if (entries.length > 0) {
            const pattern = entries.map((e) => `${e.escapedStem}[a-zA-Z]*`).join('|');
            const combinedRegex = new RegExp(`\\b(${pattern})\\b`, 'gi');

            html = html.replace(combinedRegex, (match) => {
                const lowerMatch = match.toLowerCase();
                const matchedEntry = entries.find((e) => lowerMatch.startsWith(e.wordLower));
                if (!matchedEntry) return match;
                return `<mark class="crux-word-highlight" data-word-index="${matchedEntry.index}">${match}</mark>`;
            });
        }
    }

    textEl.innerHTML = html;
    boxEl.classList.remove('hidden');

    if (onWordSelect) {
        textEl.querySelectorAll('.crux-word-highlight').forEach((markEl) => {
            markEl.addEventListener('click', () => {
                const idx = parseInt(markEl.dataset.wordIndex, 10);
                if (!Number.isNaN(idx) && words[idx]) {
                    onWordSelect(idx, words[idx]);
                }
            });
        });
    }
}

export function renderVocabGrid(container, words, onWordClick) {
    container.innerHTML = '';
    const count = words.length;

    if (count <= 4) {
        container.style.gridTemplateColumns = 'repeat(2, 1fr)';
    } else if (count <= 9) {
        container.style.gridTemplateColumns = 'repeat(3, 1fr)';
    } else {
        container.style.gridTemplateColumns = 'repeat(4, 1fr)';
    }

    words.forEach((item, index) => {
        const tile = document.createElement('div');
        tile.className = 'vocab-tile';
        tile.dataset.index = index;

        const wordSpan = document.createElement('span');
        wordSpan.className = 'tile-word';
        wordSpan.textContent = item.word;
        tile.appendChild(wordSpan);

        tile.addEventListener('click', () => onWordClick(index, item, tile));
        container.appendChild(tile);
    });
}

export function showWordDetail({ word, part_of_speech, pronunciation, definitions, example_usage }, detailElements) {
    detailElements.word.textContent = word;
    detailElements.pos.textContent = part_of_speech ? `(${part_of_speech})` : '';
    detailElements.pron.textContent = pronunciation ? `/${pronunciation}/` : '';
    detailElements.definitions.innerHTML = '';

    const defs = definitions?.length ? definitions : ['No definition available.'];
    defs.forEach((def) => {
        const li = document.createElement('li');
        li.textContent = def;
        detailElements.definitions.appendChild(li);
    });

    if (detailElements.example) {
        detailElements.example.textContent = example_usage || 'No example sentence available.';
    }

    detailElements.dialog?.showModal();
}

export function hideWordDetail(detailElements) {
    if (detailElements.dialog?.open) {
        detailElements.dialog.close();
    }
    document.querySelectorAll('.vocab-tile').forEach((t) => t.classList.remove('active-selected'));
}

export function renderPrintSheet(container, words, format = 'single') {
    if (!container || !words || words.length === 0) return;

    if (format === 'double') {
        renderDoubleSidedSheet(container, words);
    } else {
        renderSingleSidedSheet(container, words);
    }

    autoFitDefinitionText(container);
}

function renderSingleSidedSheet(container, words) {
    const CHUNK_SIZE = 5;
    let html = '';

    for (let i = 0; i < words.length; i += CHUNK_SIZE) {
        const chunk = words.slice(i, i + CHUNK_SIZE);

        html += `
            <div class="print-page-chunk">
                <table class="print-card-table">
                    <tbody>
        `;

        chunk.forEach((item) => {
            html += `
                <tr class="print-card-row">
                    <td class="print-card-word">
                        <div class="print-word-title">${escapeHtml(item.word)}</div>
                    </td>
                    <td class="print-card-def">
                        ${renderDefinitionCellContent(item)}
                    </td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;
    }

    container.innerHTML = html;
}

function renderDoubleSidedSheet(container, words) {
    const CHUNK_SIZE = 8;
    let html = '';
    let sheetNumber = 1;

    for (let i = 0; i < words.length; i += CHUNK_SIZE) {
        const chunk = words.slice(i, i + CHUNK_SIZE);

        html += `
            <div class="print-page-chunk">
                <div class="print-page-label no-print">Sheet ${sheetNumber} (Front Side — Words)</div>
                <table class="print-card-table">
                    <tbody>
        `;

        for (let r = 0; r < chunk.length; r += 2) {
            const leftWord = chunk[r];
            const rightWord = chunk[r + 1];

            html += `
                <tr class="print-card-row">
                    <td class="print-card-word">
                        <div class="print-word-title">${escapeHtml(leftWord.word)}</div>
                    </td>
                    <td class="print-card-word">
                        ${rightWord ? `<div class="print-word-title">${escapeHtml(rightWord.word)}</div>` : ''}
                    </td>
                </tr>
            `;
        }

        html += `
                    </tbody>
                </table>
            </div>
        `;

        html += `
            <div class="print-page-chunk">
                <div class="print-page-label no-print">Sheet ${sheetNumber} (Back Side — Definitions • Flipped Horizontally for Duplex)</div>
                <table class="print-card-table">
                    <tbody>
        `;

        for (let r = 0; r < chunk.length; r += 2) {
            const leftWord = chunk[r];
            const rightWord = chunk[r + 1];

            html += `
                <tr class="print-card-row">
                    <td class="print-card-def">
                        ${rightWord ? renderDefinitionCellContent(rightWord) : ''}
                    </td>
                    <td class="print-card-def">
                        ${renderDefinitionCellContent(leftWord)}
                    </td>
                </tr>
            `;
        }

        html += `
                    </tbody>
                </table>
            </div>
        `;

        sheetNumber++;
    }

    container.innerHTML = html;
}

function renderDefinitionCellContent(item) {
    const meta = [
        item.pronunciation ? `/${item.pronunciation}/` : '',
        item.part_of_speech || ''
    ].filter(Boolean).join(' • ');

    const defItems = (item.definitions && item.definitions.length > 0)
        ? item.definitions.map((d) => `<li>${escapeHtml(d)}</li>`).join('')
        : '<li>No definition available.</li>';

    return `
        <div class="print-card-def-inner">
            ${meta ? `<div class="print-def-meta">${escapeHtml(meta)}</div>` : ''}
            <ul class="print-def-list">
                ${defItems}
            </ul>
        </div>
    `;
}

function autoFitDefinitionText(container) {
    requestAnimationFrame(() => {
        const defContainers = container.querySelectorAll('.print-card-def-inner');
        defContainers.forEach((inner) => {
            const list = inner.querySelector('.print-def-list');
            if (!list) return;

            let fontSize = 14;
            list.style.fontSize = `${fontSize}px`;
            list.style.lineHeight = '1.3';

            while (inner.scrollHeight > inner.clientHeight && fontSize > 8.5) {
                fontSize -= 0.5;
                list.style.fontSize = `${fontSize}px`;
                list.style.lineHeight = fontSize < 11 ? '1.2' : '1.3';
            }
        });
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
