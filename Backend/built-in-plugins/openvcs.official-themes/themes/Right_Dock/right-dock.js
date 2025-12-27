const THEME_ID = 'right-dock';
const ATTR = 'data-theme-pack';

const root = document.documentElement;
const work = document.querySelector('.work');
const left = document.getElementById('left');
const right = document.getElementById('right');
const resizer = document.getElementById('resizer');

if (root && work && left && right && resizer && !window.__openvcsRightDockApplied) {
    window.__openvcsRightDockApplied = true;
    const originalOrder = Array.from(work.children);
    let active = false;

    const activate = () => {
        if (active) return;
        work.dataset.rightDockActive = '1';
        work.append(right, resizer, left);
        active = true;
    };

    const deactivate = () => {
        if (!active) return;
        delete work.dataset.rightDockActive;
        const fragment = document.createDocumentFragment();
        originalOrder.forEach((node) => {
            if (node.parentNode === work) {
                fragment.appendChild(node);
            }
        });
        work.appendChild(fragment);
        active = false;
    };

    const sync = () => {
        if (root.getAttribute(ATTR) === THEME_ID) {
            activate();
        } else {
            deactivate();
        }
    };

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === ATTR) {
                sync();
                break;
            }
        }
    });

    observer.observe(root, { attributes: true, attributeFilter: [ATTR] });
    window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });

    sync();
}

