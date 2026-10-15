/**
 * EPUB Reader Manager
 * Handles EPUB loading, rendering, navigation, and pagination events.
 */

export class EpubReader {
    constructor({ viewerId = 'viewer', onMetadata, onNavigation, onRelocated, onLocationsReady }) {
        this.viewerId = viewerId;
        this.onMetadata = onMetadata;
        this.onNavigation = onNavigation;
        this.onRelocated = onRelocated;
        this.onLocationsReady = onLocationsReady;
        this.book = null;
        this.rendition = null;
    }

    load(arrayBuffer) {
        if (this.book) {
            this.book.destroy();
        }

        this.book = ePub(arrayBuffer);
        this.rendition = this.book.renderTo(this.viewerId, {
            width: '100%',
            height: '100%',
            spread: 'none',
            flow: 'paginated'
        });

        this.rendition.display();

        if (this.onMetadata) {
            this.book.loaded.metadata.then(this.onMetadata);
        }

        if (this.onNavigation) {
            this.book.loaded.navigation.then(this.onNavigation);
        }

        this.book.ready
            .then(() => this.book.locations.generate(1000))
            .then(() => {
                if (this.onLocationsReady) {
                    this.onLocationsReady(this.book.locations.length());
                }
            })
            .catch((err) => console.warn('Locations generation notice:', err));

        if (this.onRelocated) {
            this.rendition.on('relocated', this.onRelocated);
        }
    }

    prev() {
        if (this.rendition) this.rendition.prev();
    }

    next() {
        if (this.rendition) this.rendition.next();
    }

    display(target) {
        if (this.rendition && target) this.rendition.display(target);
    }

    displayPage(pageNum) {
        if (this.book?.locations?.length() && this.rendition && pageNum > 0) {
            const cfi = this.book.locations.cfiFromLocation(pageNum - 1);
            if (cfi) this.rendition.display(cfi);
        }
    }

    getBook() {
        return this.book;
    }

    destroy() {
        if (this.book) {
            this.book.destroy();
            this.book = null;
            this.rendition = null;
        }
    }
}
