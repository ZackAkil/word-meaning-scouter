/**
 * EPUB Reader Manager
 * Handles EPUB loading, rendering, navigation, and whole-book pagination events.
 */

export const CHARS_PER_PAGE = 1500;

export class EpubReader {
    constructor({ viewerId = 'viewer', onMetadata, onNavigation, onRelocated, onLocationsReady }) {
        this.viewerId = viewerId;
        this.onMetadata = onMetadata;
        this.onNavigation = onNavigation;
        this.onRelocated = onRelocated;
        this.onLocationsReady = onLocationsReady;
        this.book = null;
        this.rendition = null;
        this.currentLocation = null;
        this.locationsReadyPromise = null;
    }

    load(arrayBuffer) {
        if (this.book) {
            this.book.destroy();
        }

        this.currentLocation = null;
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

        this.locationsReadyPromise = this.book.ready
            .then(() => this.book.locations.generate(CHARS_PER_PAGE))
            .then(() => {
                const totalPages = this.book.locations.length();
                if (this.onLocationsReady) {
                    this.onLocationsReady(totalPages);
                }
                if (this.currentLocation && this.onRelocated) {
                    this.onRelocated(this.currentLocation);
                }
                return totalPages;
            })
            .catch((err) => {
                console.warn('Locations generation notice:', err);
                return 0;
            });

        this.rendition.on('relocated', (location) => {
            this.currentLocation = location;
            if (this.onRelocated) {
                this.onRelocated(location);
            }
        });
    }

    async ensureLocations() {
        if (this.locationsReadyPromise) {
            await this.locationsReadyPromise;
        }
        return this.book?.locations?.length() || 0;
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

    async displayPage(pageNum) {
        const total = await this.ensureLocations();
        if (total > 0 && this.rendition && pageNum > 0) {
            const clampedPage = Math.max(1, Math.min(pageNum, total));
            const cfi = this.book.locations.cfiFromLocation(clampedPage - 1);
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
            this.currentLocation = null;
            this.locationsReadyPromise = null;
        }
    }
}
