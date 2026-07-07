//
//  ViewController.mm
//  PAGXAnimationViewer
//
//  Created by king on 2026/7/7.
//

#import "ViewController.h"

#import "OpenGLRenderView.h"

#import <QuartzCore/QuartzCore.h>

#import <algorithm>
#import <iostream>

#ifndef GL_SILENCE_DEPRECATION
#define GL_SILENCE_DEPRECATION
#endif
#import <OpenGL/gl3.h>

#import "pag/gpu.h"
#import "pagx/PAGScene.h"
#import "pagx/PAGSurface.h"
#import "pagx/PAGTimeline.h"
#import "pagx/PAGXDocument.h"
#import "pagx/PAGXImporter.h"
#import "pagx/nodes/Animation.h"
#import "tgfx/gpu/Context.h"
#import "tgfx/gpu/opengl/GLDevice.h"

using namespace pagx;

@interface ViewController () <OpenGLRenderViewDelegate>
@property (nonatomic, strong) OpenGLRenderView *renderView;
@property (nonatomic, strong) CADisplayLink *displayLink;
@end

@implementation ViewController {
    std::shared_ptr<PAGScene> scene;
    std::shared_ptr<PAGSurface> surface;
    std::shared_ptr<PAGTimeline> mainTimeline;
    int surfaceWidth;
    int surfaceHeight;
    CFTimeInterval lastFrameTime;
    CFTimeInterval currentFrameTime;
}

- (void)viewDidLoad {
    [super viewDidLoad];

    self.renderView = [[OpenGLRenderView alloc] initWithFrame:self.view.bounds];
    self.renderView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    self.renderView.delegate = self;
    [self.view addSubview:self.renderView];

    lastFrameTime = 0;
    currentFrameTime = 0;
    surfaceWidth = 0;
    surfaceHeight = 0;

    [self updateWindowTitleWithFilePath:nil];
}

- (void)viewDidAppear {
    [super viewDidAppear];
    [self.view layoutSubtreeIfNeeded];
    self.renderView.frame = self.view.bounds;
    [self invalidateRenderSurface];
    [self startDisplayLink];
    [self.renderView setNeedsDisplay:YES];
}

- (void)viewWillDisappear {
    [super viewWillDisappear];
    [self stopDisplayLink];
}

- (void)startDisplayLink {
    if (self.displayLink != nil || self.renderView == nil) {
        return;
    }

    CADisplayLink *displayLink = [self.renderView displayLinkWithTarget:self selector:@selector(displayLinkFired:)];
    displayLink.preferredFrameRateRange = CAFrameRateRangeMake(60, 60, 60);
    [displayLink addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
    self.displayLink = displayLink;
}

- (void)stopDisplayLink {
    [self.displayLink invalidate];
    self.displayLink = nil;
}

- (void)displayLinkFired:(CADisplayLink *)displayLink {
    currentFrameTime = displayLink.timestamp;
    [self.renderView setNeedsDisplay:YES];
}

- (void)viewDidLayout {
    [super viewDidLayout];
    self.renderView.frame = self.view.bounds;
    NSSize pixelSize = [self.renderView backingPixelSize];
    int width = static_cast<int>(pixelSize.width);
    int height = static_cast<int>(pixelSize.height);
    if (width != surfaceWidth || height != surfaceHeight) {
        [self invalidateRenderSurface];
    }
    [self.renderView setNeedsDisplay:YES];
}

- (void)invalidateRenderSurface {
    surface.reset();
    surfaceWidth = 0;
    surfaceHeight = 0;
}

- (void)dealloc {
    [self stopDisplayLink];
}

- (void)updateWindowTitleWithFilePath:(NSString *)filePath {
    if (filePath.length == 0) {
        self.view.window.title = @"PAGX Animation Viewer";
        return;
    }
    self.view.window.title = filePath.lastPathComponent;
}

- (void)resetPlaybackState {
    mainTimeline.reset();
    scene.reset();
    [self invalidateRenderSurface];
    lastFrameTime = 0;
    currentFrameTime = 0;
}

- (void)startPlayback {
    if (scene == nullptr) {
        return;
    }

    for (const auto &timelineId : scene->getTimelineIds()) {
        auto timeline = scene->getTimeline(timelineId);
        if (timeline == nullptr) {
            continue;
        }
        timeline->setCurrentTime(0);
        timeline->apply();
        timeline->play();
    }
    mainTimeline = scene->getDefaultTimeline();
}

- (BOOL)reloadSceneFromFile:(NSString *)filePath {
    [self resetPlaybackState];

    if (![self loadSceneFromFile:filePath]) {
        [self updateWindowTitleWithFilePath:nil];
        return NO;
    }

    [self startPlayback];
    [self updateWindowTitleWithFilePath:filePath];
    [self.renderView setNeedsDisplay:YES];
    return YES;
}

- (BOOL)loadSceneFromFile:(NSString *)filePath {
    auto document = PAGXImporter::FromFile(filePath.UTF8String);
    if (!document) {
        std::cerr << "pagx viewer: failed to load '" << filePath.UTF8String << "'\n";
        return NO;
    }

    // 方便测试观察
    for (Animation *animation : document->animations) {
        if (animation->loop != LoopMode::Loop) {
            animation->loop = LoopMode::Loop;
        }
    }

    scene = PAGScene::Make(document);
    if (scene == nullptr) {
        std::cerr << "pagx viewer: failed to build animation scene\n";
        scene.reset();
        return NO;
    }
    return YES;
}

- (void)openGLRenderView:(OpenGLRenderView *)view didAcceptPagxFileAtPath:(NSString *)filePath {
    if (![self reloadSceneFromFile:filePath]) {
        NSBeep();
    }
}

- (void)rebuildSurfaceIfNeededWithWidth:(int)width height:(int)height {
    if (width <= 0 || height <= 0) {
        return;
    }
    if (surface != nullptr && surfaceWidth == width && surfaceHeight == height) {
        return;
    }

    pag::GLFrameBufferInfo frameBufferInfo = {};
    frameBufferInfo.id = 0;
    frameBufferInfo.format = GL_RGBA8;
    pag::BackendRenderTarget renderTarget(frameBufferInfo, width, height);
    surface = PAGSurface::MakeFrom(renderTarget, pag::ImageOrigin::BottomLeft);
    if (surface == nullptr) {
        std::cerr << "pagx viewer: failed to create surface (" << width << "x" << height << ")\n";
        surfaceWidth = 0;
        surfaceHeight = 0;
        return;
    }

    surfaceWidth = width;
    surfaceHeight = height;
    [self updateDisplayTransformForWidth:width height:height];
}

- (void)updateDisplayTransformForWidth:(int)width height:(int)height {
    if (scene == nullptr || width <= 0 || height <= 0) {
        return;
    }

    float documentWidth = scene->width();
    float documentHeight = scene->height();
    if (documentWidth <= 0.0f || documentHeight <= 0.0f) {
        return;
    }

    float scale = std::min(static_cast<float>(width) / documentWidth,
                           static_cast<float>(height) / documentHeight);
    float offsetX = (static_cast<float>(width) - documentWidth * scale) * 0.5f;
    float offsetY = (static_cast<float>(height) - documentHeight * scale) * 0.5f;

    auto *displayOptions = scene->getDisplayOptions();
    displayOptions->setZoomScale(scale);
    displayOptions->setContentOffset(offsetX, offsetY);
}

- (void)advanceAnimation {
    CFTimeInterval now = currentFrameTime > 0.0 ? currentFrameTime : CACurrentMediaTime();
    int64_t deltaMicroseconds = 0;
    if (lastFrameTime > 0.0) {
        deltaMicroseconds = static_cast<int64_t>((now - lastFrameTime) * 1000000.0);
    }
    lastFrameTime = now;

    if (deltaMicroseconds <= 0) {
        return;
    }

    if (mainTimeline != nullptr) {
        mainTimeline->advanceAndApply(deltaMicroseconds);
    }
    if (scene != nullptr) {
        scene->advanceAndApply(deltaMicroseconds);
    }
}

#pragma mark - OpenGLRenderViewDelegate

- (void)openGLRenderViewDidResize:(OpenGLRenderView *)view {
    [self invalidateRenderSurface];
}

- (void)submitGPUCommands {
    auto device = tgfx::GLDevice::Current();
    if (device == nullptr) {
        return;
    }
    auto context = device->lockContext();
    if (context == nullptr) {
        return;
    }
    if (auto recording = context->flush()) {
        context->submit(std::move(recording));
    }
    device->unlock();
}

- (void)openGLRenderView:(OpenGLRenderView *)view drawWithPixelSize:(NSSize)pixelSize {
    if (scene == nullptr) {
        return;
    }

    int width = static_cast<int>(pixelSize.width);
    int height = static_cast<int>(pixelSize.height);
    [self rebuildSurfaceIfNeededWithWidth:width height:height];
    if (surface == nullptr) {
        return;
    }

    [self advanceAnimation];

    if (!scene->draw(surface, true)) {
        std::cerr << "pagx viewer: scene draw failed\n";
        return;
    }
    [self submitGPUCommands];
}

@end
