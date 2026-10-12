/** Copy only explicitly authored floating marks, preserving their group colours/transforms. */
export function detachReactionMarks(svg: SVGElement): SVGElement {
  const floating = svg.cloneNode(true) as SVGElement;
  floating.querySelectorAll('defs').forEach(node => node.remove());
  floating.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon,text,use').forEach(node => {
    if (!node.closest('[data-reaction-mark]')) node.remove();
  });
  floating.querySelectorAll('[data-reaction-mark]').forEach(node => {
    const wrapper = node.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
    wrapper.setAttribute('data-reaction-mark', node.getAttribute('data-reaction-mark')!);
    node.removeAttribute('data-reaction-mark');
    node.parentNode!.insertBefore(wrapper, node); wrapper.appendChild(node);
  });
  svg.querySelectorAll('[data-reaction-mark]').forEach(node => node.remove());
  return floating;
}
