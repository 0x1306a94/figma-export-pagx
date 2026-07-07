//
//  AppDelegate.m
//  PAGXAnimationViewer
//
//  Created by king on 2026/7/7.
//

#import "AppDelegate.h"
#import "ViewController.h"

@interface AppDelegate ()

@end

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)aNotification {
    for (NSWindow *window in NSApp.windows) {
        [window makeKeyAndOrderFront:nil];
    }
}

- (BOOL)application:(NSApplication *)application openFile:(NSString *)filename {
    if (![filename.pathExtension.lowercaseString isEqualToString:@"pagx"]) {
        return NO;
    }

    for (NSWindow *window in NSApp.windows) {
        NSViewController *viewController = window.contentViewController;
        if (viewController == nil) {
            viewController = window.windowController.contentViewController;
        }
        if ([viewController isKindOfClass:[ViewController class]]) {
            return [(ViewController *)viewController reloadSceneFromFile:filename];
        }
    }
    return NO;
}

- (void)applicationWillTerminate:(NSNotification *)aNotification {
    // Insert code here to tear down your application
}

- (BOOL)applicationSupportsSecureRestorableState:(NSApplication *)app {
    return YES;
}

@end
