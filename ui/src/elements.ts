export class Panel {
  root: HTMLElement;
  tabbar: HTMLElement;
  editor: HTMLElement;
  meditor: monaco.editor.IStandaloneCodeEditor;
  content: HTMLElement;

  tabs = new Map<string, HTMLElement>();
  models = new Map<string, monaco.editor.ITextModel | null>();
  onTabChange = new Map<string, () => boolean | void>();

  current_tab: string | null = null;
  current_model: monaco.editor.ITextModel | null = null;

  constructor(root: HTMLElement) {
    this.root = root;

    this.tabbar = document.createElement("div");
    this.tabbar.className = "tabbar";

    this.editor = document.createElement("div")
    this.editor.className = "editor";

    this.meditor = monaco.editor.create(this.editor, {
      automaticLayout: true
    });

    this.content = document.createElement("div")
    this.content.className = "content";

    root.appendChild(this.tabbar);
    root.appendChild(this.editor);
    root.appendChild(this.content);
  }

  addTab(name: string, model: monaco.editor.ITextModel | null = null, onTabChange?: () => boolean | void) {
    const tab = document.createElement("div");
    tab.className = "tab";
    tab.textContent = name;

    tab.onclick = () => this.setTab(name);

    this.tabs.set(name, tab);
    this.models.set(name, model);
    this.tabbar.appendChild(tab);

    if (this.current_tab === null)
      this.setTab(name);
  }

  setTab(name: string) {
    const tab = this.tabs.get(name);
    if (!tab)
      throw new Error(`Unknown tab: ${name}`);

    this.current_tab = name;

    for (const [tabName, el] of this.tabs) {
      el.classList.remove("active");
    }
    tab.classList.add('active');

    const model = this.models.get(name)!;
    this.meditor.setModel(model);
    this.current_model = model;
    // tab.classList.toggle('hide-editor', model == null);
    this.content.textContent = '';

    const onTabChange = this.onTabChange.get(name);
    if (onTabChange) {
      const showContent = onTabChange();
      tab.classList.toggle('hide-content', showContent === false);
    } else {
      tab.classList.add('hide-content');
    }
  }
}
