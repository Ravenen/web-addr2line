import init, { Addr2LineProcessor } from './pkg/rust_addr2line_wasm.js';

class ElfFile {
    constructor(name, path, contentBlob, tags = []) {
        this.id = crypto.randomUUID(); // Add unique ID for DB operations
        this.name = name;
        this.fullPath = path;
        this.contentBlob = contentBlob; // Store as Blob for lazy loading
        this.tags = tags;
    }
}

class Addr2LineConverter {
    constructor() {
        // Wait for both DB and Wasm to initialize before setup
        Promise.all([this.initDB(), init()])
            .then(([_, wasmModule]) => {
                this.Addr2LineProcessor = Addr2LineProcessor;
                return this.loadElfFiles();
            })
            .then(files => {
                this.elfFiles = files;
                this.activeFileIndex = files.length > 0 ? 0 : null;
                this.setupEventListeners();
                this.setupCleanupListeners();
                this.restoreCleanupRegex();
                this.renderElfFilesList();
            })
            .catch(err => {
                console.error("Initialization error:", err);
            });
    }

    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('addr2lineDB', 3); // Increment version for new schema

            request.onerror = () => reject(request.error);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('elfFiles')) {
                    const store = db.createObjectStore('elfFiles', { keyPath: 'id' });
                    store.createIndex('name', 'name');
                }
                // Add new object store for file order
                if (!db.objectStoreNames.contains('fileOrder')) {
                    db.createObjectStore('fileOrder', { keyPath: 'id' });
                }
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
        });
    }

    async loadElfFiles() {
        return new Promise(async (resolve, reject) => {
            try {
                const transaction = this.db.transaction(['elfFiles', 'fileOrder'], 'readonly');
                const store = transaction.objectStore('elfFiles');
                const orderStore = transaction.objectStore('fileOrder');
                
                const files = await new Promise((res, rej) => {
                    const request = store.getAll();
                    request.onsuccess = () => res(request.result || []);
                    request.onerror = () => rej(request.error);
                });

                const orderRequest = orderStore.get('fileOrder');
                const order = await new Promise((res) => {
                    orderRequest.onsuccess = () => res(orderRequest.result?.order || []);
                });

                // Sort files according to saved order
                if (order.length > 0) {
                    files.sort((a, b) => {
                        const indexA = order.indexOf(a.id);
                        const indexB = order.indexOf(b.id);
                        if (indexA === -1) return 1;
                        if (indexB === -1) return -1;
                        return indexA - indexB;
                    });
                }

                resolve(files);
            } catch (error) {
                reject(error);
            }
        });
    }

    async addElfFile(elfFile) {
        const transaction = this.db.transaction(['elfFiles'], 'readwrite');
        const store = transaction.objectStore('elfFiles');
        await store.add(elfFile);
        return elfFile.id;
    }

    async updateElfFile(elfFile) {
        const transaction = this.db.transaction(['elfFiles'], 'readwrite');
        const store = transaction.objectStore('elfFiles');
        await store.put(elfFile);
    }

    async deleteElfFile(id) {
        const transaction = this.db.transaction(['elfFiles'], 'readwrite');
        const store = transaction.objectStore('elfFiles');
        await store.delete(id);
    }

    async saveFileOrder() {
        const transaction = this.db.transaction(['fileOrder'], 'readwrite');
        const store = transaction.objectStore('fileOrder');
        const order = this.elfFiles.map(file => file.id);
        await store.put({ id: 'fileOrder', order });
    }

    setupEventListeners() {
        const inputText = document.getElementById('inputText');
        const elfFileInput = document.getElementById('elfFile');
        const elfUploadBtn = document.getElementById('elfUploadBtn');
        const textFileInput = document.getElementById('textFile');

        // ELF file drag and drop
        elfUploadBtn.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            elfUploadBtn.classList.add('dragover');
        });

        elfUploadBtn.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.relatedTarget && !elfUploadBtn.contains(e.relatedTarget)) {
                elfUploadBtn.classList.remove('dragover');
            }
        });

        elfUploadBtn.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            elfUploadBtn.classList.remove('dragover');
            
            const file = e.dataTransfer.files[0];
            if (file) {
                this.handleElfFileUpload({ target: { files: [file] } });
            }
        });

        // Text input handling
        inputText.addEventListener('input', () => this.convertText());
        inputText.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            inputText.classList.add('dragover');
        });
        inputText.addEventListener('dragleave', () => {
            inputText.classList.remove('dragover');
        });
        inputText.addEventListener('drop', (e) => {
            inputText.classList.remove('dragover');
            this.handleTextFileDrop(e);
        });

        // File input handling
        textFileInput.addEventListener('change', (e) => this.handleTextFileSelect(e));
        elfFileInput.addEventListener('change', (e) => this.handleElfFileUpload(e));

        this.initializeDragAndDrop();
    }

    setupCleanupListeners() {
        const regexInput = document.getElementById('regexInput');
        const applyToInputBtn = document.getElementById('applyToInputBtn');
        
        regexInput.addEventListener('input', () => {
            localStorage.setItem('cleanupRegex', regexInput.value);
            // Reapply full conversion to get fresh output with new regex
            this.convertText();
        });

        applyToInputBtn.addEventListener('click', () => {
            const inputText = document.getElementById('inputText');
            if (inputText.value) {
                const cleaned = this.cleanupText(inputText.value);
                if (cleaned !== null) {
                    inputText.value = cleaned;
                    this.convertText();
                }
            }
        });
    }

    restoreCleanupRegex() {
        const savedRegex = localStorage.getItem('cleanupRegex');
        if (savedRegex) {
            const regexInput = document.getElementById('regexInput');
            regexInput.value = savedRegex;
        }
    }

    async handleTextFileDrop(e) {
        e.preventDefault();
        e.stopPropagation();

        const file = e.dataTransfer.files[0];
        if (file) {
            const text = await file.text();
            document.getElementById('inputText').value = text;
            this.convertText();
        }
    }

    async handleTextFileSelect(e) {
        const file = e.target.files[0];
        if (file) {
            const text = await file.text();
            document.getElementById('inputText').value = text;
            this.convertText();
        }
        e.target.value = ''; // Reset input for reuse
    }

    clearInput() {
        document.getElementById('inputText').value = '';
        document.getElementById('outputText').textContent = '';
        document.getElementById('regexInput').value = '';
        localStorage.removeItem('cleanupRegex');
    }

    async copyOutput() {
        const output = document.getElementById('outputText').textContent;
        try {
            await navigator.clipboard.writeText(output);
        } catch (err) {
            console.error('Failed to copy text:', err);
        }
    }

    async handleElfFileUpload(e) {
        const file = e.target.files[0];
        if (file) {
            const elfFile = new ElfFile(
                file.name,
                file.webkitRelativePath || file.path || file.name,
                file // Store the File object directly
            );
            elfFile.displayName = file.name;
            
            const id = await this.addElfFile(elfFile);
            this.elfFiles.push(elfFile);
            this.activeFileIndex = this.elfFiles.length - 1;
            this.renderElfFilesList();

            // Save the new order
            await this.saveFileOrder();

            // Convert if input exists
            const inputText = document.getElementById('inputText').value;
            if (inputText.trim()) {
                await this.convertText();
            }
        }
    }

    initializeDragAndDrop() {
        const elfFilesList = document.getElementById('elfFilesList');
        new Sortable(elfFilesList, {
            animation: 150,
            handle: '.drag-handle',  // Only allow dragging by the handle
            onEnd: async (evt) => {
                const newIndex = evt.newIndex;
                const oldIndex = evt.oldIndex;

                const [movedItem] = this.elfFiles.splice(oldIndex, 1);
                this.elfFiles.splice(newIndex, 0, movedItem);
                
                // Save the new order
                await this.saveFileOrder();
            }
        });
    }

    renderElfFilesList() {
        const elfFilesList = document.getElementById('elfFilesList');
        elfFilesList.innerHTML = this.elfFiles.map((file, index) => `
            <li class="elf-file-item ${index === this.activeFileIndex ? 'active' : ''}" 
                data-index="${index}" >
                <i class="fas fa-grip-vertical drag-handle"></i>
                <div class="file-content" onclick="event.stopPropagation();converter.setActiveFile(${index})">
                    <span class="elf-file-name" contenteditable="true" 
                        onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}"
                        onclick="event.stopPropagation()"
                        onblur="converter.updateFileName(${index}, this.textContent)">
                        ${file.displayName || file.name}
                    </span>
                    <div class="elf-file-path" title="${file.fullPath}">
                        ${file.fullPath}
                    </div>
                    <div class="elf-file-tags">
                        ${file.tags.map(tag => `
                            <span class="tag">
                                ${tag}
                                <i class="fas fa-times" onclick="event.stopPropagation();converter.removeTag(${index}, '${tag}')"></i>
                            </span>
                        `).join('')}
                    </div>
                </div>
                <div class="file-actions" onclick="event.stopPropagation()">
                    <button onclick="event.stopPropagation();converter.addEmptyTag(${index})">
                        <i class="fas fa-tag"></i>
                    </button>
                    <button onclick="event.stopPropagation();converter.removeFile(${index})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </li>
        `).join('');
    }

    setActiveFile(index) {
        this.activeFileIndex = index;
        this.renderElfFilesList();
        this.convertText();
    }

    async convertText() {
        const inputText = document.getElementById('inputText').value;
        const outputText = document.getElementById('outputText');

        if (!inputText.trim()) {
            outputText.textContent = '';
            return;
        }

        if (this.elfFiles.length === 0 || this.activeFileIndex === null) {
            outputText.textContent = 'Please load and select an ELF file';
            return;
        }

        try {
            const activeFile = this.elfFiles[this.activeFileIndex];
            const fileArrayBuffer = await activeFile.contentBlob.arrayBuffer();
            const fileBytes = new Uint8Array(fileArrayBuffer);
            
            const processor = new this.Addr2LineProcessor(fileBytes);

            const lines = inputText.split('\n');
            const resolvedLines = [];

            for (const line of lines) {
                let resolvedLine = line;
                const matches = line.match(/0x[0-9a-fA-F]+\b/g);
                
                if (matches) {
                    for (const match of matches) {
                        try {
                            const address = BigInt(match);
                            const location = processor.lookupAddress(address);
                            if (location) {
                                resolvedLine = resolvedLine.replace(match, `${match} (${location})`);
                            }
                        } catch (e) {
                            console.warn(`Failed to process address ${match}:`, e);
                        }
                    }
                }
                resolvedLines.push(resolvedLine);
            }

            const cleanedOutput = this.applyCleanup(resolvedLines.join('\n'));
            outputText.textContent = cleanedOutput;
            processor.free();

        } catch (error) {
            console.error('Conversion error:', error);
            outputText.textContent = 'Error during conversion: ' + error.message;
        }
    }

    cleanupText(text) {
        const regexInput = document.getElementById('regexInput');
        const regexString = regexInput.value.trim();
        
        if (!regexString) return text;

        try {
            const result = this.cleanupIterativelyWithAllCaptures(text, regexString);
            if (result.success) {
                return result.result;
            } else {
                console.error(result.error);
                return null;
            }
        } catch (error) {
            console.error("Cleanup error:", error);
            return null;
        }
    }

    cleanupIterativelyWithAllCaptures(text, regexString, regexFlags = 'gm') {
        if (!regexFlags.includes('g')) {
            regexFlags += 'g';
        }

        let currentText = text;
        let previousText = null;
        let iterations = 0;
        const maxIterations = 1000;

        try {
            const regex = new RegExp(regexString, regexFlags);

            const replacer = (match, ...captureGroups) => {
                let replacementString = '';
                for (let i = 0; i < captureGroups.length - 2; i++) {
                    if (captureGroups[i] !== undefined) {
                        replacementString += captureGroups[i];
                    }
                }
                return replacementString;
            };

            while (currentText !== previousText) {
                if (iterations++ >= maxIterations) {
                    throw new Error(`Processing stopped after ${maxIterations} iterations. Check regex for potential infinite loop.`);
                }
                previousText = currentText;
                currentText = currentText.replace(regex, replacer);
            }
            return { success: true, result: currentText };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    applyCleanup(text, toOutput = true) {
        const cleanedText = this.cleanupText(text);
        if (cleanedText !== null) {
            if (toOutput) {
                document.getElementById('outputText').textContent = cleanedText;
            }
            return cleanedText;
        }
        return text;
    }

    addEmptyTag(index) {
        const tagsContainer = document.querySelector(`[data-index="${index}"] .elf-file-tags`);
        const newTag = document.createElement('span');
        newTag.className = 'tag editing';
        newTag.innerHTML = `
            <input type="text" placeholder="Enter tag" autofocus>
            <i class="fas fa-times"></i>
        `;

        tagsContainer.appendChild(newTag);

        const input = newTag.querySelector('input');
        input.focus();

        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                const tag = input.value.trim();
                if (tag && !this.elfFiles[index].tags.includes(tag)) {
                    await this.addTag(index, tag);
                } else {
                    newTag.remove();
                }
            } else if (e.key === 'Escape') {
                newTag.remove();
            }
        });

        input.addEventListener('blur', () => {
            setTimeout(() => newTag.remove(), 200);
        });

        newTag.querySelector('i').addEventListener('click', () => newTag.remove());
    }

    async removeTag(index, tag) {
        this.elfFiles[index].tags = this.elfFiles[index].tags.filter(t => t !== tag);
        await this.updateElfFile(this.elfFiles[index]);
        this.renderElfFilesList();
    }

    async addTag(index, tag) {
        this.elfFiles[index].tags.push(tag);
        await this.updateElfFile(this.elfFiles[index]);
        this.renderElfFilesList();
    }

    async updateFileName(index, newName) {
        this.elfFiles[index].displayName = newName;
        await this.updateElfFile(this.elfFiles[index]);
    }

    async removeFile(index) {
        const file = this.elfFiles[index];
        await this.deleteElfFile(file.id);
        this.elfFiles.splice(index, 1);
        
        if (this.activeFileIndex === index) {
            this.activeFileIndex = this.elfFiles.length > 0 ? 0 : null;
        } else if (this.activeFileIndex > index) {
            this.activeFileIndex--;
        }
        
        // Update stored order after removal
        await this.saveFileOrder();
        this.renderElfFilesList();
    }
}

// Initialize the converter after document is ready
document.addEventListener('DOMContentLoaded', () => {
    window.converter = new Addr2LineConverter();
});
