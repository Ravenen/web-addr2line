class ElfFile {
    constructor(name, path, tags = []) {
        this.name = name;
        this.path = path;
        this.tags = tags;
    }
}

class Addr2LineConverter {
    constructor() {
        this.elfFiles = this.loadElfFiles();
        this.setupEventListeners();
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
        const elfFilesList = document.getElementById('elfFilesList');

        // Text input handling
        inputText.addEventListener('input', () => this.convertText());
        inputText.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        inputText.addEventListener('drop', (e) => this.handleTextFileDrop(e));

        // ELF file input handling
        elfFileInput.addEventListener('change', (e) => this.handleElfFileUpload(e));

        // Initialize drag-and-drop for ELF files list
        this.initializeDragAndDrop();
        
        // Initial render
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

    async handleElfFileUpload(e) {
        const file = e.target.files[0];
        if (file) {
            // Get full path if available, otherwise use name
            const fullPath = file.webkitRelativePath || file.path || file.name;
            const elfFile = new ElfFile(fullPath, URL.createObjectURL(file));
            elfFile.displayName = file.name;
            this.elfFiles.push(elfFile);
            this.saveElfFiles();
            this.renderElfFilesList();
        }
    }

    convertText() {
        const inputText = document.getElementById('inputText').value;
        const outputText = document.getElementById('outputText');
        
        // Mock addr2line conversion (replace with actual implementation)
        const convertedText = this.mockAddr2lineConversion(inputText);
        outputText.textContent = convertedText;
    }

    mockAddr2lineConversion(text) {
        // This is a mock implementation
        // Replace with actual addr2line conversion logic
        return text.replace(/0x[0-9a-fA-F]+/g, match => 
            `${match} (converted: main.cpp:123)`);
    }

    initializeDragAndDrop() {
        const elfFilesList = document.getElementById('elfFilesList');
        new Sortable(elfFilesList, {
            animation: 150,
            onEnd: (evt) => {
                const itemEl = evt.item;
                const newIndex = evt.newIndex;
                const oldIndex = evt.oldIndex;
                
                // Reorder the elfFiles array
                const [movedItem] = this.elfFiles.splice(oldIndex, 1);
                this.elfFiles.splice(newIndex, 0, movedItem);
                this.saveElfFiles();
            }
        });
    }

    renderElfFilesList() {
        const elfFilesList = document.getElementById('elfFilesList');
        elfFilesList.innerHTML = this.elfFiles.map((file, index) => `
            <li class="elf-file-item" data-index="${index}">
                <i class="fas fa-grip-vertical drag-handle"></i>
                <div class="file-content">
                    <span class="elf-file-name" contenteditable="true" 
                        onblur="converter.updateFileName(${index}, this.textContent)">
                        ${file.displayName || file.name}
                    </span>
                    <div class="elf-file-path" title="${file.name}">${file.name}</div>
                    <div class="elf-file-tags">
                        ${file.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
                    </div>
                </div>
                <div class="file-actions">
                    <button onclick="converter.addTag(${index})">
                        <i class="fas fa-tag"></i>
                    </button>
                    <button onclick="converter.removeFile(${index})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </li>
        `).join('');
    }

    updateFileName(index, newName) {
        this.elfFiles[index].displayName = newName;
        this.saveElfFiles();
    }

    addTag(index) {
        const tag = prompt('Enter new tag:');
        if (tag) {
            this.elfFiles[index].tags.push(tag);
            this.saveElfFiles();
            this.renderElfFilesList();
        }
    }

    removeFile(index) {
        this.elfFiles.splice(index, 1);
        this.saveElfFiles();
        this.renderElfFilesList();
    }
}

// Initialize the converter
const converter = new Addr2LineConverter();
