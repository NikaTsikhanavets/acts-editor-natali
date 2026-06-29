import { Component, Input, Output, EventEmitter, OnInit, ViewChild, ElementRef, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb } from 'pdf-lib';
import { LoaderComponent } from '@components/loader/loader.component';

interface StampType {
  id: string;
  label: string;
  size: number;
  imageUrl?: string;
  imageData?: string; // base64 image data
  isCustomImage?: boolean;
}

interface Stamp {
  x: number;
  y: number;
  pageNumber: number;
  type: StampType;
}

@Component({
  selector: 'app-pdf-viewer',
  templateUrl: './pdf-viewer.component.html',
  styleUrls: ['./pdf-viewer.component.scss'],
  imports: [CommonModule, LoaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true
})
export class PdfViewerComponent implements OnInit {
  @Input() pdfFile!: File;
  @Output() goBack: EventEmitter<void> = new EventEmitter<void>();
  @ViewChild('pdfCanvas', { static: false }) pdfCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('stampCanvas', { static: false }) stampCanvas!: ElementRef<HTMLCanvasElement>;

  public pdfDocument: any;
  public currentPage: number = 1;
  public totalPages: number = 0;
  public stamps: Stamp[] = [];
  public scale: number = 1.5;
  public isLoading: boolean = true;
  public selectedStampType!: StampType;
  public currentStampSize: number = 100;
  public minStampSize: number = 50;
  public maxStampSize: number = 300;
  public cursorX: number = 0;
  public cursorY: number = 0;
  public showCursor: boolean = false;
  public stampTypes: StampType[] = [];
  public loadedImages: Map<string, HTMLImageElement> = new Map();

  // Undo/Redo functionality
  private undoStack: Stamp[][] = [];
  private redoStack: Stamp[][] = [];

  private preloadedStamps = [
    { id: 'suchilin', filename: 'suchilin_stamp.png', label: 'ИП Сучилин A.C.' },
    { id: 'suchilin-aa', filename: 'suchilin_a_a_stamp.png', label: 'ИП Сучилин A.A.' },
  ];

  constructor(private cdr: ChangeDetectorRef) {
    // Set the worker source for PDF.js
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    // Load preloaded stamps
    this.loadPreloadedStamps();
  }

  ngOnInit(): void {
    this.loadPdf();
    this.setupKeyboardShortcuts();
  }

  setupKeyboardShortcuts(): void {
    document.addEventListener('keydown', (event: KeyboardEvent) => {
      // Ctrl+Z or Cmd+Z for undo
      if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        this.undo();
      }
      // Ctrl+Y or Cmd+Shift+Z for redo
      if ((event.ctrlKey || event.metaKey) && (event.key === 'y' || (event.shiftKey && event.key === 'z'))) {
        event.preventDefault();
        this.redo();
      }
    });
  }

  async loadPreloadedStamps(): Promise<void> {
    for (const stamp of this.preloadedStamps) {
      try {
        const imageUrl = `/assets/stamps/${stamp.filename}`;
        const response = await fetch(imageUrl);
        const blob = await response.blob();

        // Convert blob to base64
        const reader = new FileReader();
        reader.onload = () => {
          const base64data = reader.result as string;
          const img = new Image();

          img.onload = () => {
            const stampType: StampType = {
              id: stamp.id,
              label: stamp.label,
              imageUrl: imageUrl,
              imageData: base64data,
              size: 150,
              isCustomImage: true
            };

            this.loadedImages.set(stamp.id, img);
            this.stampTypes.push(stampType);

            // Set first stamp as default
            if (this.stampTypes.length === 1) {
              this.selectedStampType = stampType;
              this.currentStampSize = stampType.size;
              this.cdr.detectChanges();
            }
          };

          img.src = base64data;
        };

        reader.readAsDataURL(blob);
      } catch (error) {
        console.error(`Failed to load stamp: ${stamp.filename}`, error);
      }
    }
  }

  async loadPdf(): Promise<void> {
    if (!this.pdfFile) {
      return;
    }

    try {
      const arrayBuffer = await this.pdfFile.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      this.pdfDocument = await loadingTask.promise;
      this.totalPages = this.pdfDocument.numPages;
      this.isLoading = false;
      this.cdr.detectChanges();

      await this.renderPage(this.currentPage);
    } catch (error) {
      console.error('Error loading PDF:', error);
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  async renderPage(pageNumber: number): Promise<void> {
    if (!this.pdfDocument) {
      return;
    }

    try {
      const page = await this.pdfDocument.getPage(pageNumber);
      const viewport = page.getViewport({ scale: this.scale });

      const canvas = this.pdfCanvas.nativeElement;
      const context = canvas.getContext('2d');

      if (!context) {
        return;
      }

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport
      };

      await page.render(renderContext).promise;

      // Setup stamp canvas
      const stampCanvas = this.stampCanvas.nativeElement;
      stampCanvas.width = viewport.width;
      stampCanvas.height = viewport.height;

      this.renderStamps();
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Error rendering page:', error);
    }
  }

  onCanvasClick(event: MouseEvent): void {
    const canvas = this.stampCanvas.nativeElement;
    const rect = canvas.getBoundingClientRect();

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Save current state for undo
    this.saveState();

    // Create a copy of the stamp type with current size
    const stampWithSize: StampType = {
      ...this.selectedStampType,
      size: this.currentStampSize
    };

    this.stamps.push({
      x: x,
      y: y,
      pageNumber: this.currentPage,
      type: stampWithSize
    });

    this.renderStamps();
  }

  saveState(): void {
    // Save current stamps state to undo stack
    this.undoStack.push(JSON.parse(JSON.stringify(this.stamps)));
    // Clear redo stack when new action is performed
    this.redoStack = [];
  }

  undo(): void {
    if (this.undoStack.length === 0) {
      return;
    }

    // Save current state to redo stack
    this.redoStack.push(JSON.parse(JSON.stringify(this.stamps)));

    // Restore previous state
    const previousState = this.undoStack.pop();
    if (previousState) {
      this.stamps = previousState;
      this.renderStamps();
      this.cdr.detectChanges();
    }
  }

  redo(): void {
    if (this.redoStack.length === 0) {
      return;
    }

    // Save current state to undo stack
    this.undoStack.push(JSON.parse(JSON.stringify(this.stamps)));

    // Restore next state
    const nextState = this.redoStack.pop();
    if (nextState) {
      this.stamps = nextState;
      this.renderStamps();
      this.cdr.detectChanges();
    }
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  onCanvasMouseMove(event: MouseEvent): void {
    const canvas = this.stampCanvas.nativeElement;
    const rect = canvas.getBoundingClientRect();

    this.cursorX = event.clientX - rect.left;
    this.cursorY = event.clientY - rect.top;
    this.showCursor = true;

    this.renderCursorPreview();
  }

  onCanvasMouseEnter(): void {
    this.showCursor = true;
  }

  onCanvasMouseLeave(): void {
    this.showCursor = false;
    this.clearCursorPreview();
  }

  renderCursorPreview(): void {
    if (!this.showCursor) return;

    const canvas = this.stampCanvas.nativeElement;
    const context = canvas.getContext('2d');

    if (!context) return;

    // Clear and redraw everything
    this.renderStamps();

    // Draw cursor preview
    const size = this.currentStampSize;
    const stampType = this.selectedStampType;

    if (stampType.isCustomImage && stampType.imageData) {
      // Draw image preview
      const img = this.loadedImages.get(stampType.id);
      if (img) {
        context.globalAlpha = 0.5;
        context.drawImage(img, this.cursorX - size / 2, this.cursorY - size / 2, size, size);
        context.globalAlpha = 1.0;
      }
    }
  }

  clearCursorPreview(): void {
    this.renderStamps();
  }

  selectStampType(stampType: StampType): void {
    this.selectedStampType = stampType;
    this.currentStampSize = stampType.size;
    this.cdr.detectChanges();
  }

  updateStampSize(size: number): void {
    this.currentStampSize = Math.max(this.minStampSize, Math.min(this.maxStampSize, size));
    this.cdr.detectChanges();
  }

  increaseStampSize(): void {
    this.currentStampSize = Math.min(this.maxStampSize, this.currentStampSize + 10);
    this.cdr.detectChanges();
  }

  decreaseStampSize(): void {
    this.currentStampSize = Math.max(this.minStampSize, this.currentStampSize - 10);
    this.cdr.detectChanges();
  }

  renderStamps(): void {
    const canvas = this.stampCanvas.nativeElement;
    const context = canvas.getContext('2d');

    if (!context) {
      return;
    }

    // Clear previous stamps
    context.clearRect(0, 0, canvas.width, canvas.height);

    // Draw stamps for current page
    const currentPageStamps = this.stamps.filter(s => s.pageNumber === this.currentPage);

    currentPageStamps.forEach(stamp => {
      const stampType = stamp.type;
      const size = stampType.size;

      if (stampType.isCustomImage && stampType.imageData) {
        // Draw image stamp
        const img = this.loadedImages.get(stampType.id);
        if (img) {
          context.drawImage(img, stamp.x - size / 2, stamp.y - size / 2, size, size);
        }
      }
    });
  }

  async nextPage(): Promise<void> {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      await this.renderPage(this.currentPage);
    }
  }

  async previousPage(): Promise<void> {
    if (this.currentPage > 1) {
      this.currentPage--;
      await this.renderPage(this.currentPage);
    }
  }

  clearStamps(): void {
    this.saveState();
    this.stamps = this.stamps.filter(s => s.pageNumber !== this.currentPage);
    this.renderStamps();
  }

  async downloadPdfWithStamps(): Promise<void> {
    if (!this.pdfFile || this.stamps.length === 0) {
      alert('Нет штампов для сохранения');
      return;
    }

    try {
      // Read the original PDF file
      const arrayBuffer = await this.pdfFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      const pages = pdfDoc.getPages();

      // Add stamps to each page
      for (const stamp of this.stamps) {
        const pageIndex = stamp.pageNumber - 1;
        if (pageIndex >= 0 && pageIndex < pages.length) {
          const page = pages[pageIndex];
          const { height } = page.getSize();
          const stampType = stamp.type;

          // Convert canvas coordinates to PDF coordinates
          // PDF coordinates start from bottom-left, canvas from top-left
          const pdfX = stamp.x / this.scale;
          const pdfY = height - (stamp.y / this.scale);
          const size = stampType.size / this.scale;

          if (stampType.isCustomImage && stampType.imageData) {
            // Embed image stamp
            try {
              let embeddedImage;
              if (stampType.imageData.includes('image/png')) {
                embeddedImage = await pdfDoc.embedPng(stampType.imageData);
              } else if (stampType.imageData.includes('image/jpeg') || stampType.imageData.includes('image/jpg')) {
                embeddedImage = await pdfDoc.embedJpg(stampType.imageData);
              } else {
                // Try PNG as default
                embeddedImage = await pdfDoc.embedPng(stampType.imageData);
              }

              page.drawImage(embeddedImage, {
                x: pdfX - size / 2,
                y: pdfY - size / 2,
                width: size,
                height: size,
              });
            } catch (error) {
              console.error('Error embedding image:', error);
            }
          }
        }
      }

      // Save the modified PDF
      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      // Create download link
      const link = document.createElement('a');
      link.href = url;
      link.download = `stamped_${this.pdfFile.name}`;
      link.click();

      // Clean up
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error saving PDF with stamps:', error);
      alert('Ошибка при сохранении PDF: ' + error);
    }
  }
}
