//! Process Tap と、それだけを持つ集約デバイスの作成と後始末（Core Audio）
//!
//! 作り方は `cpal` 0.18 の `host/coreaudio/macos/loopback.rs` にならう。違いは、
//! タップを「除外なし（全プロセス）」で作ることと、集約デバイスの UID にこのアプリの名前を使うこと。

use std::ptr::NonNull;
use std::sync::atomic::{AtomicU32, Ordering};

use objc2::AnyThread;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_core_audio::{
    AudioHardwareCreateAggregateDevice, AudioHardwareCreateProcessTap,
    AudioHardwareDestroyAggregateDevice, AudioHardwareDestroyProcessTap, AudioObjectID,
    CATapDescription, CATapMuteBehavior, kAudioAggregateDeviceIsPrivateKey,
    kAudioAggregateDeviceNameKey, kAudioAggregateDeviceTapAutoStartKey,
    kAudioAggregateDeviceTapListKey, kAudioAggregateDeviceUIDKey, kAudioSubTapDriftCompensationKey,
    kAudioSubTapUIDKey,
};
use objc2_core_foundation::CFDictionary;
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString};

use crate::audio_source::SourceError;

/// 集約デバイスの UID の頭。デバイスの一覧から自分の集約デバイスを除くのにも使う
pub const AGGREGATE_UID_PREFIX: &str = "com.rinontech.sonar-spectra.tap.";

static INSTANCE: AtomicU32 = AtomicU32::new(0);

/// 作成したタップと集約デバイス。drop で集約デバイス、タップの順に壊す
///
/// 集約デバイスを開いたストリームは、これより先に止めて捨てること。
#[derive(Debug)]
pub struct TapDevice {
    tap_id: AudioObjectID,
    aggregate_id: AudioObjectID,
    /// 集約デバイスの UID（`cpal` でデバイスを探すのに使う）
    pub aggregate_uid: String,
}

fn os_error(what: &str, status: i32) -> SourceError {
    SourceError::Backend(format!("{what} failed: OSStatus {status}"))
}

fn key(name: &std::ffi::CStr) -> Retained<NSString> {
    NSString::from_str(&name.to_string_lossy())
}

impl TapDevice {
    /// 出力デバイス（UID）に流れる音を、全プロセスぶん・ミュートせずに取るタップと集約デバイスを作る
    pub fn create(output_uid: &str) -> Result<Self, SourceError> {
        let pid = std::process::id();
        let instance = INSTANCE.fetch_add(1, Ordering::Relaxed);

        // 1. タップ：除外するプロセスなし（全プロセス）・ミュートしない・プライベート
        let excluded: Retained<NSArray<NSNumber>> = NSArray::new();
        let device_uid = NSString::from_str(output_uid);
        // SAFETY: 引数はどれも生きているオブジェクト。ストリームの番号0は、デバイスの最初の出力ストリーム
        let description = unsafe {
            CATapDescription::initExcludingProcesses_andDeviceUID_withStream(
                CATapDescription::alloc(),
                &excluded,
                &device_uid,
                0,
            )
        };
        // SAFETY: 生成したばかりの説明への設定
        unsafe {
            description.setMuteBehavior(CATapMuteBehavior::Unmuted);
            description.setPrivate(true);
            description.setName(&NSString::from_str(&format!(
                "sonar_spectra tap {pid}.{instance}"
            )));
        }
        let mut tap_id: AudioObjectID = 0;
        // SAFETY: 説明は有効で、出力先は書き込める変数
        let status = unsafe { AudioHardwareCreateProcessTap(Some(&description), &mut tap_id) };
        if status != 0 {
            return Err(os_error("AudioHardwareCreateProcessTap", status));
        }
        // SAFETY: 説明は有効
        let tap_uid = unsafe { description.UUID().UUIDString() };

        // 2. 集約デバイス：このタップだけを持ち、タップを自動で始める・プライベート
        let aggregate_uid = format!("{AGGREGATE_UID_PREFIX}{pid}.{instance}");
        let yes = NSNumber::new_bool(true);
        let sub_tap: Retained<NSDictionary<NSString, AnyObject>> = NSDictionary::from_slices(
            &[
                &*key(kAudioSubTapUIDKey),
                &*key(kAudioSubTapDriftCompensationKey),
            ],
            &[tap_uid.as_ref(), yes.as_ref()],
        );
        let taps: Retained<NSArray<AnyObject>> = NSArray::from_slice(&[sub_tap.as_ref()]);
        let name = NSString::from_str(&format!("sonar_spectra aggregate {pid}.{instance}"));
        let uid = NSString::from_str(&aggregate_uid);
        let properties: Retained<NSDictionary<NSString, AnyObject>> = NSDictionary::from_slices(
            &[
                &*key(kAudioAggregateDeviceNameKey),
                &*key(kAudioAggregateDeviceUIDKey),
                &*key(kAudioAggregateDeviceTapListKey),
                &*key(kAudioAggregateDeviceTapAutoStartKey),
                &*key(kAudioAggregateDeviceIsPrivateKey),
            ],
            &[
                name.as_ref(),
                uid.as_ref(),
                taps.as_ref(),
                yes.as_ref(),
                yes.as_ref(),
            ],
        );
        // SAFETY: NSDictionary と CFDictionary は toll-free bridge で同じオブジェクトとして扱える
        let properties_cf: &CFDictionary =
            unsafe { &*(Retained::as_ptr(&properties).cast::<CFDictionary>()) };
        let mut aggregate_id: AudioObjectID = 0;
        // SAFETY: 辞書は有効で、出力先は書き込める変数
        let status = unsafe {
            AudioHardwareCreateAggregateDevice(properties_cf, NonNull::from(&mut aggregate_id))
        };
        if status != 0 {
            // SAFETY: 作成に成功したタップ
            unsafe { AudioHardwareDestroyProcessTap(tap_id) };
            return Err(os_error("AudioHardwareCreateAggregateDevice", status));
        }

        Ok(Self {
            tap_id,
            aggregate_id,
            aggregate_uid,
        })
    }
}

impl Drop for TapDevice {
    fn drop(&mut self) {
        // SAFETY: どちらも作成に成功したもの。失敗しても drop の中では何もできないので結果は見ない
        unsafe {
            AudioHardwareDestroyAggregateDevice(self.aggregate_id);
            AudioHardwareDestroyProcessTap(self.tap_id);
        }
    }
}
