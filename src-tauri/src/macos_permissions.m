#import <AppKit/AppKit.h>
#import <AVFoundation/AVFoundation.h>
#import <ApplicationServices/ApplicationServices.h>
#import <dispatch/dispatch.h>
#import <objc/runtime.h>
#import <os/log.h>
#import <stdatomic.h>

// Only operational metadata belongs here, never transcript or clipboard contents.
void verba_diagnostic_event(const char *message) {
  static os_log_t log;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ log = os_log_create("com.verba", "runtime"); });
  os_log_with_type(log, OS_LOG_TYPE_DEFAULT, "%{public}s", message);
}

// 0 = not trusted, 1 = trusted, 2 = trusted but this process still holds a stale
// event-posting denial. CGPreflightPostEventAccess is evaluated once per process,
// so a grant made while Verba runs only reaches event posting after a relaunch.
int verba_accessibility_state(bool prompt) {
  bool trusted;
  if (prompt) {
    NSDictionary *options = @{
      (__bridge id)kAXTrustedCheckOptionPrompt: @YES
    };
    trusted = AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
  } else {
    trusted = AXIsProcessTrusted();
  }
  bool canPost = trusted;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wunguarded-availability-new"
  if ([NSProcessInfo.processInfo isOperatingSystemAtLeastVersion:(NSOperatingSystemVersion){10, 15, 0}])
    canPost = CGPreflightPostEventAccess();
#pragma clang diagnostic pop
  static atomic_int previous = -1;
  int current = (trusted ? 1 : 0) | (canPost ? 2 : 0);
  if (atomic_exchange(&previous, current) != current || prompt) {
    NSString *event = [NSString stringWithFormat:@"accessibility trusted=%d post_events=%d prompt=%d", trusted, canPost, prompt];
    verba_diagnostic_event(event.UTF8String);
  }
  if (!trusted) return 0;
  return canPost ? 1 : 2;
}

int verba_microphone_authorization_status(void) {
  SEL selector = @selector(authorizationStatusForMediaType:);
  if ([AVCaptureDevice respondsToSelector:selector]) {
    AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
    return (int)status;
  }

  return 3;
}

bool verba_request_microphone_access(void) {
  SEL selector = @selector(requestAccessForMediaType:completionHandler:);
  if ([AVCaptureDevice respondsToSelector:selector]) {
    __block BOOL granted = NO;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);

    [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL didGrant) {
      granted = didGrant;
      dispatch_semaphore_signal(semaphore);
    }];

    dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);
    return granted;
  }

  return true;
}

static void verba_make_overlay_view_transparent(NSView *view) {
  if (!view) {
    return;
  }

  view.wantsLayer = YES;
  view.layer.backgroundColor = NSColor.clearColor.CGColor;

  @try {
    [view setValue:@NO forKey:@"drawsBackground"];
  } @catch (__unused NSException *exception) {
  }

  @try {
    [view setValue:@NO forKey:@"opaque"];
  } @catch (__unused NSException *exception) {
  }

  @try {
    id scrollView = [view valueForKey:@"scrollView"];
    if ([scrollView isKindOfClass:NSScrollView.class]) {
      NSScrollView *webScrollView = (NSScrollView *)scrollView;
      webScrollView.drawsBackground = NO;
      webScrollView.backgroundColor = NSColor.clearColor;
    }
  } @catch (__unused NSException *exception) {
  }

  for (NSView *subview in view.subviews) {
    verba_make_overlay_view_transparent(subview);
  }
}


// A real nonactivating panel keeps clicks from changing the dictation target.
@interface VerbaOverlayPanel : NSPanel
@end
@implementation VerbaOverlayPanel
- (BOOL)canBecomeKeyWindow { return NO; }
- (BOOL)canBecomeMainWindow { return NO; }
@end

static BOOL verba_focused_window_frame(NSRect *result) {
  pid_t pid = NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
  if (pid <= 0 || !AXIsProcessTrusted()) return NO;
  AXUIElementRef app = AXUIElementCreateApplication(pid);
  AXUIElementSetMessagingTimeout(app, 0.05);
  CFTypeRef window = NULL, position = NULL, size = NULL;
  BOOL found = NO;
  if (AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute, &window) == kAXErrorSuccess &&
      window && CFGetTypeID(window) == AXUIElementGetTypeID()) {
    // Returned AX elements have their own timeout; a hung target must not freeze Verba.
    AXUIElementSetMessagingTimeout((AXUIElementRef)window, 0.025);
    if (AXUIElementCopyAttributeValue((AXUIElementRef)window, kAXPositionAttribute, &position) == kAXErrorSuccess &&
      AXUIElementCopyAttributeValue((AXUIElementRef)window, kAXSizeAttribute, &size) == kAXErrorSuccess &&
      position && size && CFGetTypeID(position) == AXValueGetTypeID() && CFGetTypeID(size) == AXValueGetTypeID()) {
      CGPoint point; CGSize dimensions;
      if (AXValueGetValue((AXValueRef)position, kAXValueCGPointType, &point) &&
          AXValueGetValue((AXValueRef)size, kAXValueCGSizeType, &dimensions) &&
          dimensions.width > 0 && dimensions.height > 0) {
        CGFloat desktopTop = NSMaxY(NSScreen.screens.firstObject.frame);
        *result = NSMakeRect(point.x, desktopTop - point.y - dimensions.height,
                             dimensions.width, dimensions.height);
        found = YES;
      }
    }
  }
  if (size) CFRelease(size);
  if (position) CFRelease(position);
  if (window) CFRelease(window);
  CFRelease(app);
  return found;
}

// All positions are AppKit points, including displays with different pixel scales.
NSRect verba_overlay_frame(NSRect target, NSRect visible, NSSize size) {
  CGFloat x = NSMidX(target) - size.width / 2;
  CGFloat y = NSMinY(target) + 16;
  x = MAX(NSMinX(visible), MIN(x, NSMaxX(visible) - size.width));
  y = MAX(NSMinY(visible), MIN(y, NSMaxY(visible) - size.height));
  return NSMakeRect(x, y, size.width, size.height);
}

@interface VerbaOverlayController : NSObject
@property(nonatomic, strong) VerbaOverlayPanel *panel;
@property(nonatomic, strong) NSTimer *timer;
- (instancetype)initWithWindow:(NSWindow *)window;
- (void)track;
- (void)show;
- (void)hide;
@end

@implementation VerbaOverlayController
- (instancetype)initWithWindow:(NSWindow *)window {
  if ((self = [super init])) {
    _panel = [[VerbaOverlayPanel alloc] initWithContentRect:window.frame
      styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
      backing:NSBackingStoreBuffered defer:NO];
    _panel.releasedWhenClosed = NO;
    _panel.opaque = NO;
    _panel.backgroundColor = NSColor.clearColor;
    _panel.hasShadow = NO;
    _panel.hidesOnDeactivate = NO;
    _panel.canHide = NO;
    _panel.becomesKeyOnlyIfNeeded = YES;
    _panel.ignoresMouseEvents = NO;
    _panel.level = NSStatusWindowLevel;
    NSWindowCollectionBehavior behavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
      NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorIgnoresCycle;
    // NSProcessInfo avoids a Clang availability-runtime dependency in the Rust binary.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wunguarded-availability-new"
    if ([NSProcessInfo.processInfo isOperatingSystemAtLeastVersion:(NSOperatingSystemVersion){13, 0, 0}])
      behavior |= NSWindowCollectionBehaviorCanJoinAllApplications;
#pragma clang diagnostic pop
    _panel.collectionBehavior = behavior;
    // Tao owns this content view and uses it to resolve native window handles.
    // Detaching it makes the next Tauri window operation panic in ns_view().
    // Reparent only the webview children, keeping the framework's host intact.
    NSView *host = window.contentView;
    NSView *content = _panel.contentView;
    for (NSView *surface in host.subviews.copy) {
      [content addSubview:surface];
      surface.frame = content.bounds;
      surface.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    }
    verba_make_overlay_view_transparent(content);
    [window orderOut:nil];
    NSNotificationCenter *center = NSWorkspace.sharedWorkspace.notificationCenter;
    [center addObserver:self selector:@selector(workspaceChanged:) name:NSWorkspaceDidActivateApplicationNotification object:nil];
    [center addObserver:self selector:@selector(workspaceChanged:) name:NSWorkspaceActiveSpaceDidChangeNotification object:nil];
  }
  return self;
}
- (void)workspaceChanged:(NSNotification *)notification {
  if (_timer) { [self track]; [_panel orderFrontRegardless]; }
}
- (void)track {
  NSArray<NSScreen *> *screens = NSScreen.screens;
  if (!screens.count) return;
  NSRect target;
  BOOL focused = verba_focused_window_frame(&target);
  NSScreen *screen = screens.firstObject;
  CGFloat bestArea = 0;
  for (NSScreen *candidate in screens) {
    if (focused) {
      NSRect overlap = NSIntersectionRect(target, candidate.frame);
      CGFloat area = overlap.size.width * overlap.size.height;
      if (area > bestArea) { bestArea = area; screen = candidate; }
    } else if (NSPointInRect(NSEvent.mouseLocation, candidate.frame)) {
      screen = candidate;
    }
  }
  if (!focused) target = screen.visibleFrame;
  NSRect frame = verba_overlay_frame(target, screen.visibleFrame, _panel.frame.size);
  if (!NSEqualRects(frame, _panel.frame)) [_panel setFrame:frame display:YES];
}
- (void)show {
  [self track];
  [_panel orderFrontRegardless];
  if (!_timer) {
    __weak VerbaOverlayController *weakSelf = self;
    _timer = [NSTimer timerWithTimeInterval:0.15 repeats:YES block:^(__unused NSTimer *timer) {
      [weakSelf track];
    }];
    [NSRunLoop.mainRunLoop addTimer:_timer forMode:NSRunLoopCommonModes];
  }
}
- (void)hide { [_timer invalidate]; _timer = nil; [_panel orderOut:nil]; }
- (void)dealloc {
  [_timer invalidate];
  [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:self];
  [_panel close];
}
@end

static const char verba_overlay_controller_key;
static VerbaOverlayController *verba_overlay_controller(NSWindow *window) {
  VerbaOverlayController *controller = objc_getAssociatedObject(window, &verba_overlay_controller_key);
  if (!controller) {
    controller = [[VerbaOverlayController alloc] initWithWindow:window];
    objc_setAssociatedObject(window, &verba_overlay_controller_key, controller, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  return controller;
}
static void verba_run_overlay_window_operation(NSWindow *window, dispatch_block_t operation) {
  if (!window) return;
  if (NSThread.isMainThread) operation();
  else dispatch_async(dispatch_get_main_queue(), operation);
}
void verba_configure_overlay_window(void *window_ptr) {
  NSWindow *window = (__bridge NSWindow *)window_ptr;
  verba_run_overlay_window_operation(window, ^{ (void)verba_overlay_controller(window); });
}
// layout: 0 = compact pill, 1 = wide pill (rewrite with prompt name), 2 = dialog.
void verba_set_overlay_window_layout(void *window_ptr, int layout) {
  NSWindow *window = (__bridge NSWindow *)window_ptr;
  verba_run_overlay_window_operation(window, ^{
    VerbaOverlayController *controller = verba_overlay_controller(window);
    NSSize size = layout == 2 ? NSMakeSize(308, 140) : layout == 1 ? NSMakeSize(308, 52) : NSMakeSize(150, 52);
    [controller.panel setContentSize:size];
    [controller track];
  });
}
void verba_show_overlay_window_without_activation(void *window_ptr) {
  NSWindow *window = (__bridge NSWindow *)window_ptr;
  verba_run_overlay_window_operation(window, ^{ [verba_overlay_controller(window) show]; });
}
void verba_hide_overlay_window(void *window_ptr) {
  NSWindow *window = (__bridge NSWindow *)window_ptr;
  verba_run_overlay_window_operation(window, ^{ [verba_overlay_controller(window) hide]; });
}

// Frontmost-app and selection queries go straight to AppKit and Accessibility.
// They must never go through AppleScript/System Events: a cold System Events
// launch while a hold shortcut is down makes macOS report the hotkey as released.

CFStringRef verba_frontmost_app_name(void) {
  NSString *name = NSWorkspace.sharedWorkspace.frontmostApplication.localizedName;
  return name.length ? (CFStringRef)CFBridgingRetain([name copy]) : NULL;
}

int verba_frontmost_app_pid(void) {
  pid_t pid = NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
  return pid > 0 ? pid : -1;
}

static BOOL verba_app_matches_name(NSRunningApplication *app, NSString *name) {
  NSString *executable = app.executableURL.lastPathComponent;
  return (app.localizedName && [app.localizedName caseInsensitiveCompare:name] == NSOrderedSame) ||
         (executable && [executable caseInsensitiveCompare:name] == NSOrderedSame);
}

int verba_app_pid_by_name(CFStringRef cfName) {
  NSString *name = (__bridge NSString *)cfName;
  NSRunningApplication *front = NSWorkspace.sharedWorkspace.frontmostApplication;
  if (front && verba_app_matches_name(front, name)) return front.processIdentifier;
  for (NSRunningApplication *app in NSWorkspace.sharedWorkspace.runningApplications) {
    if (app.activationPolicy == NSApplicationActivationPolicyRegular && verba_app_matches_name(app, name))
      return app.processIdentifier;
  }
  return -1;
}

bool verba_activate_app_pid(int pid) {
  NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
  return app && [app activateWithOptions:0];
}

// Selected text in the focused element of the frontmost app, or NULL. Short
// timeouts keep a hung target from delaying the start of a recording.
static CFStringRef verba_copy_selected_text(AXUIElementRef app) {
  CFTypeRef focused = NULL, selected = NULL;
  CFStringRef result = NULL;
  if (AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute, &focused) == kAXErrorSuccess &&
      focused && CFGetTypeID(focused) == AXUIElementGetTypeID()) {
    AXUIElementSetMessagingTimeout((AXUIElementRef)focused, 0.1);
    if (AXUIElementCopyAttributeValue((AXUIElementRef)focused, kAXSelectedTextAttribute, &selected) == kAXErrorSuccess &&
        selected && CFGetTypeID(selected) == CFStringGetTypeID() && CFStringGetLength(selected) > 0) {
      result = (CFStringRef)CFRetain(selected);
    }
  }
  if (selected) CFRelease(selected);
  if (focused) CFRelease(focused);
  return result;
}

CFStringRef verba_focused_selected_text(void) {
  pid_t pid = NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
  if (pid <= 0 || !AXIsProcessTrusted()) return NULL;
  AXUIElementRef app = AXUIElementCreateApplication(pid);
  if (!app) return NULL;
  AXUIElementSetMessagingTimeout(app, 0.1);
  CFStringRef result = verba_copy_selected_text(app);
  // Electron apps (Slack, VS Code, Discord, ...) expose no accessibility tree until
  // a client sets AXManualAccessibility. The tree builds asynchronously, so retry
  // briefly. Other apps reject the attribute and keep returning nothing.
  if (!result &&
      AXUIElementSetAttributeValue(app, CFSTR("AXManualAccessibility"), kCFBooleanTrue) == kAXErrorSuccess) {
    for (int attempt = 0; attempt < 8 && !result; attempt++) {
      usleep(40 * 1000);
      result = verba_copy_selected_text(app);
    }
  }
  CFRelease(app);
  return result;
}
