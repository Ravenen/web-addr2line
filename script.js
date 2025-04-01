class ElfFile {
    constructor(name, path, data, tags = []) {
        this.name = name;
        this.path = path;
        this.data = data; // Store file data as base64
        this.tags = tags;
    }
}

class Addr2LineConverter {
    constructor() {
        this.elfFiles = this.loadElfFiles();
        this.setupEventListeners();
        this.apiUrl = 'http://localhost:8000'; // Change in production
        this.activeFileIndex = this.elfFiles.length > 0 ? 0 : null;
    }

    loadElfFiles() {
        return JSON.parse(localStorage.getItem('elfFiles')) || [];
    }

    saveElfFiles() {
        localStorage.setItem('elfFiles', JSON.stringify(this.elfFiles));
    }

    setupEventListeners() {
        const inputText = document.getElementById('inputText');
        const elfFileInput = document.getElementById('elfFile');
        const textFileInput = document.getElementById('textFile');

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
        this.renderElfFilesList();
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
            let fullPath = file.webkitRelativePath || file.path || file.name;

            if (fullPath === file.name) {
                try {
                    fullPath = e.target.files[0].mozFullPath || file.name;
                } catch (e) {
                    fullPath = file.name;
                }
            }

            // Read file as base64
            const fileData = await this.fileToBase64(file);

            const elfFile = new ElfFile(
                file.name,
                URL.createObjectURL(file), // Keep for backward compatibility
                fileData
            );
            elfFile.displayName = file.name;
            elfFile.fullPath = fullPath;
            this.elfFiles.push(elfFile);
            this.saveElfFiles();
            this.activeFileIndex = this.elfFiles.length - 1;
            this.renderElfFilesList();
        }
    }

    initializeDragAndDrop() {
        const elfFilesList = document.getElementById('elfFilesList');
        new Sortable(elfFilesList, {
            animation: 150,
            onEnd: (evt) => {
                const itemEl = evt.item;
                const newIndex = evt.newIndex;
                const oldIndex = evt.oldIndex;

                const [movedItem] = this.elfFiles.splice(oldIndex, 1);
                this.elfFiles.splice(newIndex, 0, movedItem);
                this.saveElfFiles();
            }
        });
    }

    renderElfFilesList() {
        const elfFilesList = document.getElementById('elfFilesList');
        elfFilesList.innerHTML = this.elfFiles.map((file, index) => `
            <li class="elf-file-item ${index === this.activeFileIndex ? 'active' : ''}" 
                data-index="${index}" 
                onclick="converter.setActiveFile(${index})">
                <i class="fas fa-grip-vertical drag-handle"></i>
                <div class="file-content">
                    <span class="elf-file-name" contenteditable="true" 
                        onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}"
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
                                <i class="fas fa-times" onclick="converter.removeTag(${index}, '${tag}')"></i>
                            </span>
                        `).join('')}
                    </div>
                </div>
                <div class="file-actions">
                    <button onclick="converter.addEmptyTag(${index})">
                        <i class="fas fa-tag"></i>
                    </button>
                    <button onclick="converter.removeFile(${index})">
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
            const formData = new FormData();
            formData.append('log_text', inputText);

            // Convert base64 back to blob
            const activeFile = this.elfFiles[this.activeFileIndex];
            const fileBlob = await this.base64ToBlob(activeFile.data);
            formData.append('elf_file', fileBlob, activeFile.name);

            const apiResponse = await fetch(`${this.apiUrl}/resolve_log`, {
                method: 'POST',
                body: formData,
                mode: 'cors',
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                }
            });

            if (!apiResponse.ok) {
                const errorData = await apiResponse.json();
                throw new Error(errorData.detail || 'API request failed');
            }

            const result = await apiResponse.json();
            outputText.textContent = result.resolved_log;
        } catch (error) {
            console.error('Conversion error:', error);
            outputText.textContent = 'Error during conversion: ' + error.message;
        }
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

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const tag = input.value.trim();
                if (tag && !this.elfFiles[index].tags.includes(tag)) {
                    this.elfFiles[index].tags.push(tag);
                    this.saveElfFiles();
                    this.renderElfFilesList();
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

    removeTag(index, tag) {
        this.elfFiles[index].tags = this.elfFiles[index].tags.filter(t => t !== tag);
        this.saveElfFiles();
        this.renderElfFilesList();
    }

    updateFileName(index, newName) {
        this.elfFiles[index].displayName = newName;
        this.saveElfFiles();
    }

    removeFile(index) {
        this.elfFiles.splice(index, 1);
        this.saveElfFiles();
        this.renderElfFilesList();
    }

    async fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    async base64ToBlob(base64) {
        const response = await fetch(base64);
        return response.blob();
    }
}

// Initialize the converter
const converter = new Addr2LineConverter();
