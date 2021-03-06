import {
  lookup
} from 'mime-types';
import tag from 'html-tag-js';
import fsOperation from './utils/fsOperation';
import collapsableList from '../components/collapsableList';
import helpers from './helpers';
import dialogs from '../components/dialogs';
import tile from '../components/tile';
import constants from '../constants';
import recents from './recents';
import path from './utils/path';
import createEditorFromURI from './createEditorFromURI';

/**
 * 
 * @param {string} _path
 * @param {object} [opts]
 * @param {boolean} [opts.saveState=true]
 * @param {boolean} [opts.reloadOnResume=true]
 */
function openFolder(_path, opts = {}) {

  let flag = false;
  for (let folder of addedFolder) {
    if (folder.url === _path) {
      flag = true;
      break;
    }
  }
  if (flag) return;

  let saveState = true,
    reloadOnResume = true;

  if ('saveState' in opts) saveState = opts.saveState;
  if ('reloadOnResume' in opts) reloadOnResume = opts.reloadOnResume;

  const listState = JSON.parse(localStorage.state || '{}');
  const title = getTitle();
  const $closeBtn = tag('span', {
    className: 'icon cancel',
    attr: {
      action: 'close'
    },
    onclick: remove
  });
  let $root = collapsableList(title, !!!listState[_path], "folder", {
    tail: $closeBtn,
    allCaps: true,
    ontoggle: function (state) {
      if (state === "uncollapsed")
        for (let folder of addedFolder)
          if (folder.url !== _path) folder.$node.collapse();

      expandList.call(this);
    }
  });
  /**
   * @type {{url: string, $el: HTMLElement, action: "cut"|"copy"}}
   */
  let clipBoard = null;
  const loading = {
    start() {
      $root.$title.classList.add('loading');
    },
    stop() {
      $root.$title.classList.remove('loading');
    }
  };
  const $text = $root.$title.querySelector(":scope>span.text");
  if ($text) {
    $text.style.overflow = "hidden";
    $text.style.whiteSpace = "nowrap";
    $text.style.textOverflow = "ellipsis";
  }
  $root.$title.setAttribute('type', 'root');
  $root.$title.setAttribute('url', _path);
  $root.$title.setAttribute('name', title);

  $root.$ul.onclick =
    $root.$ul.oncontextmenu =
    $root.$title.onclick =
    $root.$title.oncontextmenu = handleItems;

  addedFolder.push({
    url: _path,
    remove,
    $node: $root,
    reload: () => {
      if (!reloadOnResume) return;
      $root.collapse();
      $root.uncollapse();
    },
    reloadOnResume,
    saveState
  });

  updateHeight();
  recents.addFolder(_path, opts);
  editorManager.sidebar.appendChild($root);

  function getTitle() {
    let title = '';
    try {
      const {
        username,
        hostname,
        port
      } = new URL(_path);
      if (username && hostname) title = `${username}@${hostname}`;
      else if (hostname) title = hostname;

      if (hostname && port) title += ':' + port;

      if (title) return title;
      else return path.name(_path);

    } catch (error) {
      return path.name(_path);
    }
  }

  function remove(e) {

    if (e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }

    if ($root.isConnected) {
      $root.remove();
      $root = null;
    }
    const tmpFolders = [];
    for (let folder of addedFolder)
      if (folder.url !== _path) tmpFolders.push(folder);
    addedFolder = tmpFolders;
    updateHeight();
  }

  function updateHeight() {

    openFolder.updateHeight();

  }

  /**
   * 
   * @param {Event} e 
   */
  function handleItems(e) {
    const mode = e.type;
    const $target = e.target;
    if (!($target instanceof HTMLElement)) return;
    const type = $target.getAttribute('type');
    if (!type) return;
    const url = $target.getAttribute('url');
    const name = $target.getAttribute('name');

    if (mode === 'click') handleClick(type, url, name, $target);
    else if (mode === 'contextmenu') handleContextmenu(type, url, name, $target);
  }

  /**
   * 
   * @param {"file"|"dir"|"root"} type 
   * @param {string} url 
   * @param {string} name 
   * @param {HTMLElement} $target 
   */
  function handleClick(type, url, name, $target) {
    if (type === 'file') {

      createEditorFromURI(url);
      editorManager.sidebar.hide();

    }
  }



  /**
   * 
   * @param {"file"|"dir"|"root"} type 
   * @param {string} url 
   * @param {string} name 
   * @param {HTMLElement} $target 
   */
  function handleContextmenu(type, url, name, $target) {

    navigator.vibrate(50);
    const cancel = strings.cancel + (clipBoard ? ' (' + strings[clipBoard.action] + ')' : '');
    const COPY = ['copy', strings.copy, 'copy'],
      CUT = ['cut', strings.cut, 'cut'],
      REMOVE = ['delete', strings.delete, 'delete'],
      RENAME = ['rename', strings.rename, 'edit'],
      PASTE = ['paste', strings.paste, 'paste', !!clipBoard],
      NEW_FILE = ['new file', strings['new file'], 'document-add'],
      NEW_FOLDER = ['new folder', strings['new folder'], 'folder-add'],
      CANCEL = ['cancel', cancel, 'clearclose'];

    let options;

    if (type === 'file') options = [COPY, CUT, RENAME, REMOVE];
    else if (type === 'dir') options = [COPY, CUT, REMOVE, RENAME, PASTE, NEW_FILE, NEW_FOLDER];
    else if (type === 'root') options = [REMOVE, RENAME, PASTE, NEW_FILE, NEW_FOLDER];

    if (clipBoard) options.push(CANCEL);

    dialogs.select(name, options)
      .then(res => {
        execOperation(type, res, url, $target, name)
          .finally(loading.stop);
      });

  }

  /**
   * @param {"dir"|"file"|"root"} type
   * @param {"copy"|"cut"|"delete"|"rename"|"paste"|"new file"|"new folder"|"cancel"} action 
   * @param {string} url target url
   * @param {HTMLElement} $target target element
   * @param {string} name Name of file or folder
   */
  function execOperation(type, action, url, $target, name) {
    let newName, CASE = '',
      src, srcName, srcType, $src, file, msg, defaultValue;

    if (type === "dir" && !url.endsWith("/")) url += "/";

    const target = $target.getAttribute('state');

    switch (action) {
      case "copy":
      case "cut":
        clipBoard = {
          url,
          action,
          $el: $target
        };
        if (action === "cut") $target.classList.add('cut');
        else $target.classList.remove('cut');
        return Promise.resolve();

      case "delete":
        msg = strings["delete {name}"].replace('{name}', name);

        return dialogs.confirm(strings.warging, msg)
          .then(res => {
            loading.start();
            return fsOperation(url);
          })
          .then(fs => {
            if (type === "dir") return fs.deleteDir();
            else if (type === "file") return fs.deleteFile();
          })
          .then(res => {
            if (type === 'file') $target.remove();
            else $target.parentElement.remove();
            helpers.showToast(strings.success);
          })
          .catch(err => {
            console.log(err);
            helpers.error(err);
          });

      case "rename":

        return dialogs.prompt(strings.rename, name, "text", {
            match: constants.FILE_NAME_REGEX,
            required: true
          })
          .then(newname => {
            loading.start();
            newName = newname;
            if (newName !== name)
              return fsOperation(url)
                .then(fs => {
                  return fs.renameTo(newName);
                })
                .then(res => {
                  $target.querySelector(':scope>.text').textContent = newName;
                  $target.setAttribute('url', url.replace(new RegExp(name + '\/?$'), newName));
                  $target.setAttribute('name', newName);

                  if (type === 'file')
                    $target.querySelector(':scope>span').className = helpers.getIconForFile(newName);

                  file = editorManager.getFile(url, 'fileUri');
                  if (file) file.filename = newName;

                  helpers.showToast(strings.success);
                });
          })
          .catch(err => {
            console.log(err);
            helpers.error(err);
          });

      case "paste":
        $src = clipBoard.$el;
        srcType = $src.getAttribute('type');
        src = $src.isConnected ?
          (srcType === "file" ? $src.parentElement : $src.parentElement.parentElement)
          .previousElementSibling.getAttribute('state') :
          "uncollapsed";
        srcName = $src.getAttribute('name');

        CASE += srcType === "file" ? 1 : 0;
        CASE += src === "collapsed" ? 1 : 0;
        CASE += target === "collapsed" ? 1 : 0;

        return fsOperation(clipBoard.url)
          .then(fs => {
            if (clipBoard.action === 'cut') return fs.moveTo(url);
            else return fs.copyTo(url);
          })
          .then(res => {

            /**
             * CASES:
             * CASE 111: src is file and parent is collapsed where target is also collapsed
             * CASE 110: src is file and parent is collapsed where target is uncollapsed
             * CASE 101: src is file and parent is uncollapsed where target is collapsed
             * CASE 100: src is file and parent is uncollapsed where target is also uncollapsed
             * CASE 011: src is directory and parent is collapsed where target is also collapsed
             * CASE 001: src is directory and parent is uncollapsed where target is also collapsed
             * CASE 010: src is directory and parent is collapsed where target is also uncollapsed
             * CASE 000: src is directory and parent is uncollapsed where target is also uncollapsed
             */

            if (clipBoard.action === 'cut') { //move

              switch (CASE) {
                case '111':
                case '011':
                  break;

                case '110':
                  appendTile($target, createFileTile(srcName, join(url, encodeURI(srcName))));
                  break;

                case '101':
                  $src.remove();
                  break;

                case '100':
                  appendTile($target, createFileTile(srcName, join(url, encodeURI(srcName))));
                  $src.remove();
                  break;

                case '001':
                  $src.parentElement.remove();
                  break;

                case '010':
                  appendList($target, createFolderTile(srcName, join(url, encodeURI(srcName))));
                  break;

                case '000':
                  appendList($target, createFolderTile(srcName, join(url, encodeURI(srcName))));
                  $src.parentElement.remove();
                  break;

                default:
                  break;
              }

            } else { //copy

              switch (CASE) {
                case '111':
                case '101':
                case '011':
                case '001':
                  break;

                case '110':
                case '100':
                  appendTile($target, createFileTile(srcName, join(url, encodeURI(srcName))));
                  break;

                case '010':
                case '000':
                  appendList($target, createFolderTile(srcName, join(url, encodeURI(srcName))));
                  break;

                default:
                  break;
              }

            }

            helpers.showToast(strings.success);

          })
          .catch(err => {
            console.log(err);
            helpers.error(err);
          });

      case "new file":
      case "new folder":
        msg = action === "new file" ? strings["enter file name"] : strings["enter folder name"];
        defaultValue = action === "new file" ? constants.DEFAULT_FILE_NAME : strings['new folder'];
        return dialogs.prompt(msg, defaultValue, "text", {
            match: constants.FILE_NAME_REGEX,
            required: true
          })
          .then(res => {
            loading.start();
            newName = res;
            return fsOperation(url);
          })
          .then(fs => {
            if (action === "new file") return fs.createFile(newName);
            else return fs.createDirectory(newName);
          })
          .then(res => {
            if (target === "uncollapsed") {
              if (action === "new file") appendTile($target, createFileTile(newName, url + encodeURI(newName)));
              else appendList($target, createFolderTile(newName, url + encodeURI(newName)));
            }

            helpers.showToast(strings.success);
          })
          .catch(err => {
            console.log(err);
            helpers.error(err);
          });

      case "cancel":
        clipBoard.$el.classList.remove('cut');
        clipBoard = null;
        return Promise.resolve();

    }

    function join(path1, path2) {
      if (path1.slice(-1) !== '/' || path2[0] !== '/') return path1 + '/' + path2;
      return path1 + path2;
    }

    /**
     * 
     * @param {HTMLElement} $target 
     * @param {HTMLElement} $src 
     */
    function appendTile($target, $src) {
      $target = $target.nextElementSibling;
      const $firstTile = $target.querySelector(':scope>[type=file]');
      if ($firstTile) $target.insertBefore($src, $firstTile);
      else $target.append($src);

    }

    /**
     * 
     * @param {HTMLElement} $target 
     * @param {HTMLElement} $src 
     */
    function appendList($target, $src) {
      $target = $target.nextElementSibling;
      const $firstList = $target.firstElementChild;
      if ($firstList) $target.insertBefore($src, $firstList);
      else $target.append($src);
    }


  }

  function createFileTile(name, url) {
    const $tile = tile({
      lead: tag('span', {
        className: helpers.getIconForFile(name)
      }),
      text: name
    });
    $tile.setAttribute('url', url);
    $tile.setAttribute('name', name);
    $tile.setAttribute('type', 'file');

    return $tile;
  }

  function createFolderTile(name, url) {

    const $list = collapsableList(name, !!!listState[url], "folder", {
      ontoggle: expandList
    });
    $list.$title.setAttribute('url', url);
    $list.$title.setAttribute('type', 'dir');
    $list.$title.setAttribute('name', name);

    return $list;
  }

  /**
   * 
   * @this {import('../components/collapsableList').Collaspable}
   */
  function expandList() {
    const $target = this.$title;
    const $ul = this.$ul;
    const url = $target.getAttribute("url");
    const state = $target.getAttribute("state");

    if (!$ul) return;
    $ul.textContent = null;

    if (saveState) listState[url] = false;

    if (state === 'uncollapsed') {
      loading.start();
      if (saveState) listState[url] = true;
      fsOperation(url)
        .then(fs => {
          return fs.lsDir();
        })
        .then(entries => {
          entries = helpers.sortDir(entries, {
            sortByName: "on",
            showHiddenFiles: "on"
          }, true);
          entries.map(entry => {
            const name = path.name(entry.url);
            if (entry.isDirectory) {

              const $list = createFolderTile(name, entry.url);
              $ul.appendChild($list);

            } else {

              const $item = createFileTile(name, entry.url);
              $ul.append($item);

            }
          });
        })
        .catch(err => {
          this.collapse();
          helpers.error(err);
          console.error(err);
        })
        .finally(() => {
          loading.stop();
        });
    }

    localStorage.setItem('state', JSON.stringify(listState));
  }

}

openFolder.updateHeight = function () {
  const client = editorManager.openFileList.getBoundingClientRect();
  let totalFolder = addedFolder.length - 1;
  for (let folder of addedFolder) {
    folder.$node.style.maxHeight = `calc(100% - ${(totalFolder*30) + client.height}px)`;
    folder.$node.style.height = `calc(100% - ${(totalFolder*30) + client.height}px)`;
  }
}

export default openFolder;