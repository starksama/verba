#import <AppKit/AppKit.h>

void verba_configure_overlay_window(void *window);
void verba_set_overlay_window_expanded(void *window, bool expanded);
void verba_show_overlay_window_without_activation(void *window);
void verba_hide_overlay_window(void *window);

#define CHECK(condition, message) do { \
  if (!(condition)) { fprintf(stderr, "FAIL: %s\n", message); return 1; } \
} while (0)

int main(void) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 128, 44)
      styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
    window.releasedWhenClosed = NO;
    NSView *host = window.contentView;
    NSView *surface = [[NSView alloc] initWithFrame:host.bounds];
    [host addSubview:surface];
    void *handle = (__bridge void *)window;

    verba_configure_overlay_window(handle);
    CHECK(window.contentView == host, "framework-owned content view must remain attached");
    CHECK(host.window == window, "native handles must still resolve the original window");
    NSWindow *panel = surface.window;
    CHECK([panel isKindOfClass:NSPanel.class], "overlay surface must belong to a panel");
    CHECK(panel != window, "panel must be separate from the framework window");
    CHECK(!panel.canBecomeKeyWindow && !panel.canBecomeMainWindow, "overlay must not take focus");
    CHECK(panel.styleMask & NSWindowStyleMaskNonactivatingPanel, "panel must be nonactivating");

    for (int i = 0; i < 3; i++) {
      verba_configure_overlay_window(handle);
      CHECK(surface.window == panel, "configuration must reuse the same panel");
      verba_set_overlay_window_expanded(handle, true);
      NSSize expanded = surface.frame.size;
      CHECK(expanded.width > host.bounds.size.width && expanded.height > host.bounds.size.height,
        "expanded state must make room for its controls");
      verba_set_overlay_window_expanded(handle, false);
      CHECK(NSEqualSizes(surface.frame.size, host.bounds.size), "collapsed state must match the window");
      verba_show_overlay_window_without_activation(handle);
      CHECK(panel.visible && !window.visible, "only the panel should be shown");
      verba_hide_overlay_window(handle);
      CHECK(!panel.visible, "idle state must hide the panel");
      CHECK(window.contentView == host && host.window == window, "native handles must survive state updates");
    }
    [window close];
    puts("PASS: overlay ownership, native handles, resize, focus, repeated show/hide");
  }
  return 0;
}
